import type {
  ActorReference,
  AppError,
  CombatLogVersion,
  ConfidenceReason,
  DiscoveryResult,
  EncounterEnvelope,
  InputFileMetadata,
  OperationResult,
  OwnedEntityObservation,
  ParserMetadata,
  ParserWarning,
  PlayerCandidate,
  RawCombatLogRecord,
  RawTimestamp,
  ResolvedSessionDiscoveryOptions,
  SessionCandidate,
  SessionConfidence,
  SessionDiscoveryOptions,
  TargetCandidate,
} from "../contracts";
import { actorReference, classifyActorGuid } from "../parser/actors";
import { IncrementalLineDecoder, type DecodedLine } from "../parser/lineReader";
import { PARSER_VERSION } from "../parser/parser";
import { parseRawRecord } from "../parser/rawRecord";
import {
  defaultSchemaRegistry,
  parseCombatLogVersion,
  type CombatLogSchema,
  type CombatLogSchemaRegistry,
} from "../parser/schema";

const TICKS_PER_MILLISECOND = 10n;
const AFFILIATION_MINE = 0x1;

export const DEFAULT_SESSION_DISCOVERY_OPTIONS: ResolvedSessionDiscoveryOptions =
  {
    inactivityThresholdMs: 10_000,
    likelyMinimumDurationMs: 20_000,
    likelyMinimumPlayerInitiatedActions: 2,
    likelyMinimumQualifyingActions: 3,
    includeIncidental: false,
  };

export interface DiscoveryScanOptions extends SessionDiscoveryOptions {
  readonly registry?: CombatLogSchemaRegistry;
  readonly manualSchemaId?: string;
  readonly shouldAbort?: () => boolean;
  readonly onBytesProcessed?: (bytesProcessed: number) => void;
}

interface ActorAggregate {
  guid: string;
  name?: string;
  flags?: string;
  raidFlags?: string;
  mine: boolean;
}

interface PlayerAggregate extends ActorAggregate {
  firstActivity?: RawTimestamp;
  lastActivity?: RawTimestamp;
  outgoingCasts: number;
  outgoingDamage: number;
  hostileActions: number;
  targets: Set<string>;
}

interface TargetAggregate extends ActorAggregate {
  firstInteraction: RawTimestamp;
  lastInteraction: RawTimestamp;
  interactionCount: number;
  damageFromPlayer: number;
  playerGuids: Set<string>;
}

interface OwnedAggregate extends ActorAggregate {
  ownerGuid: string;
  evidence: OwnedEntityObservation["evidence"];
}

interface CandidateWindow {
  playerGuid: string;
  startTime: RawTimestamp;
  endTime: RawTimestamp;
  lastQualifyingTime: RawTimestamp;
  targetGuids: Set<string>;
  qualifyingActionCount: number;
  playerInitiatedActionCount: number;
}

interface OpenEncounter {
  startTime: RawTimestamp;
  encounterId?: number;
  name?: string;
}

function appError(
  category: AppError["category"],
  code: string,
  message: string,
  suggestedAction: string,
): AppError {
  return {
    category,
    code,
    message,
    recoverable: true,
    suggestedAction,
  };
}

function cancelledError(): AppError {
  return appError(
    "cancelled",
    "OPERATION_CANCELLED",
    "Processing was cancelled.",
    "Choose a file to start a new scan.",
  );
}

function field(record: RawCombatLogRecord, index: number): string | undefined {
  return record.fields[index]?.value;
}

function parseFlags(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasMineFlag(value: string | undefined): boolean {
  return (parseFlags(value) & AFFILIATION_MINE) !== 0;
}

function isRealGuid(guid: string | undefined): guid is string {
  return (
    guid !== undefined &&
    guid !== "nil" &&
    guid !== "0000000000000000" &&
    guid.length > 0
  );
}

function actorFromRecord(
  record: RawCombatLogRecord,
  offset: 1 | 5,
): ActorReference | undefined {
  const guid = field(record, offset);
  const flags = field(record, offset + 2);
  if (!isRealGuid(guid) || flags?.startsWith("0x") !== true) return undefined;
  return actorReference(
    guid,
    field(record, offset + 1),
    flags,
    field(record, offset + 3),
  );
}

function isTargetActor(
  actor: ActorReference | undefined,
): actor is ActorReference {
  return (
    actor !== undefined && actor.type !== "player" && actor.type !== "unknown"
  );
}

function isCast(eventType: string): boolean {
  return eventType === "SPELL_CAST_START" || eventType === "SPELL_CAST_SUCCESS";
}

function isDamage(eventType: string): boolean {
  return (
    eventType === "SPELL_DAMAGE" ||
    eventType === "SPELL_PERIODIC_DAMAGE" ||
    eventType === "SWING_DAMAGE" ||
    eventType === "RANGE_DAMAGE" ||
    eventType === "SPELL_MISSED" ||
    eventType === "SWING_MISSED" ||
    eventType === "RANGE_MISSED"
  );
}

function isPeriodic(eventType: string): boolean {
  return eventType === "SPELL_PERIODIC_DAMAGE";
}

function isExplicitHostile(record: RawCombatLogRecord): boolean {
  if (
    [
      "SPELL_DAMAGE",
      "SWING_DAMAGE",
      "RANGE_DAMAGE",
      "SPELL_MISSED",
      "SWING_MISSED",
      "RANGE_MISSED",
      "SPELL_CAST_START",
      "SPELL_CAST_SUCCESS",
    ].includes(record.eventType)
  ) {
    return true;
  }
  return (
    record.eventType === "SPELL_AURA_APPLIED" && field(record, 12) === "DEBUFF"
  );
}

function damageAmount(record: RawCombatLogRecord): number {
  const candidate =
    record.eventType === "SWING_DAMAGE" ? field(record, 9) : field(record, 12);
  if (candidate === undefined || candidate.includes("-")) return 0;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveOptions(
  options: SessionDiscoveryOptions,
): OperationResult<ResolvedSessionDiscoveryOptions> {
  const resolved = {
    inactivityThresholdMs:
      options.inactivityThresholdMs ??
      DEFAULT_SESSION_DISCOVERY_OPTIONS.inactivityThresholdMs,
    likelyMinimumDurationMs:
      options.likelyMinimumDurationMs ??
      DEFAULT_SESSION_DISCOVERY_OPTIONS.likelyMinimumDurationMs,
    likelyMinimumPlayerInitiatedActions:
      options.likelyMinimumPlayerInitiatedActions ??
      DEFAULT_SESSION_DISCOVERY_OPTIONS.likelyMinimumPlayerInitiatedActions,
    likelyMinimumQualifyingActions:
      options.likelyMinimumQualifyingActions ??
      DEFAULT_SESSION_DISCOVERY_OPTIONS.likelyMinimumQualifyingActions,
    includeIncidental:
      options.includeIncidental ??
      DEFAULT_SESSION_DISCOVERY_OPTIONS.includeIncidental,
  };
  const numeric = [
    resolved.inactivityThresholdMs,
    resolved.likelyMinimumDurationMs,
    resolved.likelyMinimumPlayerInitiatedActions,
    resolved.likelyMinimumQualifyingActions,
  ];
  if (numeric.some((value) => !Number.isFinite(value) || value < 0)) {
    return {
      ok: false,
      error: appError(
        "internal",
        "INVALID_DISCOVERY_OPTIONS",
        "The session discovery settings are invalid.",
        "Restore the default discovery settings and try again.",
      ),
      warnings: [],
    };
  }
  return { ok: true, value: resolved, warnings: [] };
}

function durationTicks(
  first: RawTimestamp | undefined,
  last: RawTimestamp | undefined,
): bigint {
  if (first === undefined || last === undefined) return 0n;
  return last.localTimeTicks - first.localTimeTicks;
}

export class DiscoveryScanner {
  readonly #file: InputFileMetadata;
  readonly #options: ResolvedSessionDiscoveryOptions;
  readonly #registry: CombatLogSchemaRegistry;
  readonly #manualSchemaId: string | undefined;
  readonly #actors = new Map<string, ActorAggregate>();
  readonly #players = new Map<string, PlayerAggregate>();
  readonly #targets = new Map<string, TargetAggregate>();
  readonly #owned = new Map<string, OwnedAggregate>();
  readonly #mineOwnedActors = new Map<string, ActorAggregate>();
  readonly #openWindows = new Map<string, CandidateWindow>();
  readonly #windows: CandidateWindow[] = [];
  readonly #encounters: EncounterEnvelope[] = [];
  #openEncounter: OpenEncounter | undefined;
  #schema: CombatLogSchema | undefined;
  #parser: ParserMetadata | undefined;
  #lastTimestamp: RawTimestamp | undefined;
  #recordsScanned = 0;
  #warnings: ParserWarning[] = [];
  #segmentWindowStartIndex = 0;

  constructor(
    file: InputFileMetadata,
    options: ResolvedSessionDiscoveryOptions,
    registry = defaultSchemaRegistry,
    manualSchemaId?: string,
  ) {
    this.#file = file;
    this.#options = options;
    this.#registry = registry;
    this.#manualSchemaId = manualSchemaId;
  }

  get retainedState() {
    return {
      actorCount: this.#actors.size,
      targetCount: this.#targets.size,
      candidateWindowCount: this.#windows.length + this.#openWindows.size,
      ownedEntityCount: this.#owned.size + this.#mineOwnedActors.size,
      encounterEnvelopeCount:
        this.#encounters.length + (this.#openEncounter === undefined ? 0 : 1),
      retainedCombatEventCount: 0 as const,
      retainedRawLineCount: 0 as const,
    };
  }

  consume(record: RawCombatLogRecord): OperationResult<undefined> {
    this.#recordsScanned += 1;
    if (
      this.#lastTimestamp !== undefined &&
      record.timestamp.localTimeTicks < this.#lastTimestamp.localTimeTicks
    ) {
      this.#closeAllWindows();
      this.#segmentWindowStartIndex = this.#windows.length;
    }
    this.#lastTimestamp = record.timestamp;

    if (record.eventType === "COMBAT_LOG_VERSION") {
      if (this.#recordsScanned > 1) {
        this.#closeAllWindows();
        this.#segmentWindowStartIndex = this.#windows.length;
      }
      const version = parseCombatLogVersion(record);
      if (!version.ok) return version;
      return this.#selectSchema(version.value);
    }

    const boundaries = this.#schema?.discoveryBoundaries;
    if (boundaries?.encounterStartEventTypes.includes(record.eventType)) {
      // Pre-pull hostile records immediately preceding an explicit encounter
      // marker belong to that genuine encounter, not to a dummy attempt.
      this.#openWindows.clear();
      this.#discardEncounterLeadIn(record.timestamp);
      this.#openEncounter = {
        startTime: record.timestamp,
        ...this.#encounterIdentity(record),
      };
      return { ok: true, value: undefined, warnings: [] };
    }
    if (boundaries?.encounterEndEventTypes.includes(record.eventType)) {
      this.#openWindows.clear();
      const identity = this.#encounterIdentity(record);
      const start = this.#openEncounter;
      if (start !== undefined) {
        this.#encounters.push({
          ...start,
          endTime: record.timestamp,
          ...(identity.success === undefined
            ? {}
            : { success: identity.success }),
        });
      }
      this.#openEncounter = undefined;
      this.#segmentWindowStartIndex = this.#windows.length;
      return { ok: true, value: undefined, warnings: [] };
    }
    if (boundaries?.hardBoundaryEventTypes.includes(record.eventType)) {
      this.#closeAllWindows();
      this.#segmentWindowStartIndex = this.#windows.length;
      return { ok: true, value: undefined, warnings: [] };
    }

    if (record.eventType === "COMBATANT_INFO") {
      const combatantGuid = field(record, 1);
      if (
        isRealGuid(combatantGuid) &&
        classifyActorGuid(combatantGuid) === "player"
      ) {
        this.#observeActor(
          actorReference(combatantGuid, undefined, undefined, undefined),
        );
      }
      return { ok: true, value: undefined, warnings: [] };
    }

    const source = actorFromRecord(record, 1);
    const destination = actorFromRecord(record, 5);
    this.#observeActor(source);
    this.#observeActor(destination);
    this.#observePlayerActivity(record, source, destination);
    this.#observeOwnership(record, source, destination);

    if (boundaries?.targetEndEventTypes.includes(record.eventType)) {
      if (destination !== undefined)
        this.#closeWindowsForTarget(destination.guid);
      return { ok: true, value: undefined, warnings: [] };
    }

    if (this.#openEncounter !== undefined || !isTargetActor(destination)) {
      return { ok: true, value: undefined, warnings: [] };
    }

    const ownerGuid =
      source?.type === "player"
        ? source.guid
        : this.#owned.get(source?.guid ?? "")?.ownerGuid;
    if (ownerGuid === undefined)
      return { ok: true, value: undefined, warnings: [] };
    const directPlayer = source?.guid === ownerGuid;
    const explicit = directPlayer && isExplicitHostile(record);
    const extension = isPeriodic(record.eventType) || !directPlayer;
    if (!explicit && !extension)
      return { ok: true, value: undefined, warnings: [] };

    this.#observeInteraction(record, ownerGuid, destination, explicit);
    return { ok: true, value: undefined, warnings: [] };
  }

  finish(): OperationResult<DiscoveryResult> {
    this.#closeAllWindows();
    if (this.#openEncounter !== undefined) {
      this.#encounters.push({
        ...this.#openEncounter,
        ...(this.#lastTimestamp === undefined
          ? {}
          : { endTime: this.#lastTimestamp }),
      });
      this.#openEncounter = undefined;
    }
    if (this.#recordsScanned === 0) {
      return {
        ok: false,
        error: appError(
          "empty-file",
          "NO_COMBAT_LOG_RECORDS",
          "No WoW combat-log records were found.",
          "Choose a non-empty WoWCombatLog.txt file.",
        ),
        warnings: this.#warnings,
      };
    }
    if (this.#parser === undefined) {
      return {
        ok: false,
        error: appError(
          "invalid-combat-log",
          "MISSING_LOG_VERSION",
          "The input does not contain a combat-log version record.",
          "Choose the complete WoWCombatLog.txt file.",
        ),
        warnings: this.#warnings,
      };
    }

    const recorderGuids = [...this.#players.values()]
      .filter((player) => player.mine)
      .map((player) => player.guid);
    const soleRecorderGuid =
      recorderGuids.length === 1 ? recorderGuids[0] : undefined;
    if (soleRecorderGuid !== undefined)
      this.#resolveMineOwned(soleRecorderGuid);
    if (this.#players.size === 0) {
      return {
        ok: false,
        error: appError(
          "no-player-characters",
          "NO_PLAYER_CHARACTERS",
          "No player characters were found in this combat log.",
          "Make sure combat logging was enabled while a character was active.",
        ),
        warnings: this.#warnings,
      };
    }

    const players = this.#playerCandidates();
    const targets = this.#targetCandidates();
    const sessions = this.#sessionCandidates();
    const ownedEntities = [...this.#owned.values()]
      .map((owned): OwnedEntityObservation => ({
        guid: owned.guid,
        ...(owned.name === undefined ? {} : { name: owned.name }),
        ...(owned.flags === undefined ? {} : { flags: owned.flags }),
        ...(owned.raidFlags === undefined
          ? {}
          : { raidFlags: owned.raidFlags }),
        type: classifyActorGuid(owned.guid),
        ownerGuid: owned.ownerGuid,
        evidence: owned.evidence,
      }))
      .sort((left, right) => left.guid.localeCompare(right.guid));

    return {
      ok: true,
      value: {
        parser: this.#parser,
        file: this.#file,
        players,
        ...(soleRecorderGuid === undefined
          ? {}
          : { proposedRecorderGuid: soleRecorderGuid }),
        targets,
        sessions,
        ownedEntities,
        encounterEnvelopes: this.#encounters,
        recordsScanned: this.#recordsScanned,
        retainedState: this.retainedState,
      },
      warnings: this.#warnings,
    };
  }

  #selectSchema(version: CombatLogVersion): OperationResult<undefined> {
    const selected = this.#registry.select(version, {
      ...(this.#manualSchemaId === undefined
        ? {}
        : { manualSchemaId: this.#manualSchemaId }),
    });
    if (!selected.ok) return selected;
    this.#schema = selected.value.schema;
    this.#parser = {
      parserVersion: PARSER_VERSION,
      schema: {
        id: selected.value.schema.id,
        selection: selected.value.selection,
        detectedVersion: version,
      },
    };
    this.#warnings.push(...selected.warnings);
    return { ok: true, value: undefined, warnings: [] };
  }

  #encounterIdentity(record: RawCombatLogRecord) {
    const idValue = Number(field(record, 1));
    const name = field(record, 2);
    const success =
      record.eventType === "ENCOUNTER_END"
        ? field(record, 5) === "1"
        : undefined;
    return {
      ...(Number.isFinite(idValue) ? { encounterId: idValue } : {}),
      ...(name === undefined ? {} : { name }),
      ...(success === undefined ? {} : { success }),
    };
  }

  #observeActor(actor: ActorReference | undefined): void {
    if (actor === undefined) return;
    const existing = this.#actors.get(actor.guid);
    const observed: ActorAggregate = {
      guid: actor.guid,
      ...(actor.name === undefined ? {} : { name: actor.name }),
      ...(actor.flags === undefined ? {} : { flags: actor.flags }),
      ...(actor.raidFlags === undefined ? {} : { raidFlags: actor.raidFlags }),
      mine: hasMineFlag(actor.flags),
    };
    if (existing === undefined) this.#actors.set(actor.guid, observed);
    else {
      if (observed.name !== undefined) existing.name = observed.name;
      if (observed.flags !== undefined) existing.flags = observed.flags;
      if (observed.raidFlags !== undefined)
        existing.raidFlags = observed.raidFlags;
      existing.mine ||= observed.mine;
    }

    if (actor.type === "player") {
      const player = this.#players.get(actor.guid);
      if (player === undefined) {
        this.#players.set(actor.guid, {
          ...observed,
          outgoingCasts: 0,
          outgoingDamage: 0,
          hostileActions: 0,
          targets: new Set(),
        });
      } else {
        if (observed.name !== undefined) player.name = observed.name;
        if (observed.flags !== undefined) player.flags = observed.flags;
        if (observed.raidFlags !== undefined)
          player.raidFlags = observed.raidFlags;
        player.mine ||= observed.mine;
      }
    } else if (observed.mine) {
      this.#mineOwnedActors.set(actor.guid, observed);
    }
  }

  #observePlayerActivity(
    record: RawCombatLogRecord,
    source: ActorReference | undefined,
    destination: ActorReference | undefined,
  ): void {
    if (source?.type !== "player") return;
    const player = this.#players.get(source.guid);
    if (player === undefined) return;
    player.firstActivity ??= record.timestamp;
    player.lastActivity = record.timestamp;
    if (isCast(record.eventType)) player.outgoingCasts += 1;
    if (isDamage(record.eventType)) player.outgoingDamage += 1;
    if (isTargetActor(destination) && isExplicitHostile(record)) {
      player.hostileActions += 1;
      player.targets.add(destination.guid);
    }
  }

  #observeOwnership(
    record: RawCombatLogRecord,
    source: ActorReference | undefined,
    destination: ActorReference | undefined,
  ): void {
    if (
      source?.type !== "player" ||
      !isTargetActor(destination) ||
      !["SPELL_SUMMON", "SPELL_CREATE"].includes(record.eventType)
    ) {
      return;
    }
    this.#owned.set(destination.guid, {
      guid: destination.guid,
      ...(destination.name === undefined ? {} : { name: destination.name }),
      ...(destination.flags === undefined ? {} : { flags: destination.flags }),
      ...(destination.raidFlags === undefined
        ? {}
        : { raidFlags: destination.raidFlags }),
      mine: hasMineFlag(destination.flags),
      ownerGuid: source.guid,
      evidence: record.eventType === "SPELL_CREATE" ? "create" : "summon",
    });
    this.#mineOwnedActors.delete(destination.guid);
  }

  #resolveMineOwned(ownerGuid: string): void {
    for (const actor of this.#mineOwnedActors.values()) {
      if (this.#owned.has(actor.guid)) continue;
      this.#owned.set(actor.guid, {
        ...actor,
        ownerGuid,
        evidence: "affiliation-mine",
      });
    }
    this.#mineOwnedActors.clear();
  }

  #observeInteraction(
    record: RawCombatLogRecord,
    playerGuid: string,
    target: ActorReference,
    explicit: boolean,
  ): void {
    const thresholdTicks =
      BigInt(Math.trunc(this.#options.inactivityThresholdMs)) *
      TICKS_PER_MILLISECOND;
    let window = this.#openWindows.get(playerGuid);
    if (
      window !== undefined &&
      record.timestamp.localTimeTicks -
        window.lastQualifyingTime.localTimeTicks >
        thresholdTicks
    ) {
      this.#closeWindow(playerGuid);
      window = undefined;
    }
    if (window === undefined) {
      if (!explicit && !this.#options.includeIncidental) return;
      window = {
        playerGuid,
        startTime: record.timestamp,
        endTime: record.timestamp,
        lastQualifyingTime: record.timestamp,
        targetGuids: new Set(),
        qualifyingActionCount: 0,
        playerInitiatedActionCount: 0,
      };
      this.#openWindows.set(playerGuid, window);
    }
    window.endTime = record.timestamp;
    window.lastQualifyingTime = record.timestamp;
    window.targetGuids.add(target.guid);
    window.qualifyingActionCount += 1;
    if (explicit) window.playerInitiatedActionCount += 1;

    const existing = this.#targets.get(target.guid);
    if (existing === undefined) {
      this.#targets.set(target.guid, {
        guid: target.guid,
        ...(target.name === undefined ? {} : { name: target.name }),
        ...(target.flags === undefined ? {} : { flags: target.flags }),
        ...(target.raidFlags === undefined
          ? {}
          : { raidFlags: target.raidFlags }),
        mine: hasMineFlag(target.flags),
        firstInteraction: record.timestamp,
        lastInteraction: record.timestamp,
        interactionCount: 1,
        damageFromPlayer: explicit ? damageAmount(record) : 0,
        playerGuids: new Set([playerGuid]),
      });
    } else {
      if (target.name !== undefined) existing.name = target.name;
      existing.lastInteraction = record.timestamp;
      existing.interactionCount += 1;
      existing.damageFromPlayer += explicit ? damageAmount(record) : 0;
      existing.playerGuids.add(playerGuid);
    }
  }

  #closeWindow(playerGuid: string): void {
    const window = this.#openWindows.get(playerGuid);
    if (window === undefined) return;
    this.#windows.push(window);
    this.#openWindows.delete(playerGuid);
  }

  #closeAllWindows(): void {
    for (const playerGuid of [...this.#openWindows.keys()]) {
      this.#closeWindow(playerGuid);
    }
  }

  #closeWindowsForTarget(targetGuid: string): void {
    for (const [playerGuid, window] of this.#openWindows) {
      if (window.targetGuids.has(targetGuid)) this.#closeWindow(playerGuid);
    }
  }

  #discardEncounterLeadIn(encounterStart: RawTimestamp): void {
    const thresholdTicks =
      BigInt(Math.trunc(this.#options.inactivityThresholdMs)) *
      TICKS_PER_MILLISECOND;
    for (
      let index = this.#windows.length - 1;
      index >= this.#segmentWindowStartIndex;
      index -= 1
    ) {
      const window = this.#windows[index];
      if (window === undefined) continue;
      const leadInGap =
        encounterStart.localTimeTicks - window.endTime.localTimeTicks;
      if (leadInGap >= 0n && leadInGap <= thresholdTicks) {
        this.#windows.splice(index, 1);
      }
    }
  }

  #playerCandidates(): readonly PlayerCandidate[] {
    const rawScores = new Map<string, number>();
    for (const player of this.#players.values()) {
      const seconds =
        Number(durationTicks(player.firstActivity, player.lastActivity)) /
        10_000;
      const consistency = Math.min(
        1,
        player.hostileActions / Math.max(1, seconds / 3),
      );
      rawScores.set(
        player.guid,
        Math.log1p(player.outgoingCasts) +
          Math.log1p(player.outgoingDamage) * 2 +
          Math.log1p(Math.max(0, seconds)) +
          player.targets.size * 0.75 +
          consistency * 2,
      );
    }
    const maximum = Math.max(1, ...rawScores.values());
    return [...this.#players.values()]
      .map((player): PlayerCandidate => ({
        guid: player.guid,
        ...(player.name === undefined ? {} : { name: player.name }),
        ...(player.flags === undefined ? {} : { flags: player.flags }),
        ...(player.raidFlags === undefined
          ? {}
          : { raidFlags: player.raidFlags }),
        type: "player",
        activityScore: (rawScores.get(player.guid) ?? 0) / maximum,
        recorderCandidate: player.mine,
        outgoingCastCount: player.outgoingCasts,
        outgoingDamageCount: player.outgoingDamage,
        interactionDurationTicks: durationTicks(
          player.firstActivity,
          player.lastActivity,
        ),
        targetInteractionCount: player.targets.size,
      }))
      .sort(
        (left, right) =>
          right.activityScore - left.activityScore ||
          left.guid.localeCompare(right.guid),
      );
  }

  #targetCandidates(): readonly TargetCandidate[] {
    const sessionTargetGuids = new Set(
      this.#windows
        .filter(
          (window) =>
            window.playerInitiatedActionCount > 0 ||
            this.#options.includeIncidental,
        )
        .flatMap((window) => [...window.targetGuids]),
    );
    const maximumInteractions = Math.max(
      1,
      ...[...this.#targets.values()]
        .filter((target) => sessionTargetGuids.has(target.guid))
        .map((target) => target.interactionCount),
    );
    return [...this.#targets.values()]
      .filter((target) => sessionTargetGuids.has(target.guid))
      .map((target): TargetCandidate => {
        const duration = durationTicks(
          target.firstInteraction,
          target.lastInteraction,
        );
        const durationSeconds = Number(duration) / 10_000;
        const activityScore =
          (target.interactionCount / maximumInteractions) * 0.65 +
          Math.min(1, durationSeconds / 20) * 0.25 +
          (classifyActorGuid(target.guid) === "creature" ? 0.1 : 0);
        return {
          guid: target.guid,
          ...(target.name === undefined ? {} : { name: target.name }),
          ...(target.flags === undefined ? {} : { flags: target.flags }),
          ...(target.raidFlags === undefined
            ? {}
            : { raidFlags: target.raidFlags }),
          type: classifyActorGuid(target.guid),
          interactionCount: target.interactionCount,
          damageFromPlayer: target.damageFromPlayer,
          interactingPlayerCount: target.playerGuids.size,
          interactionDurationTicks: duration,
          activityScore,
        };
      })
      .sort(
        (left, right) =>
          right.activityScore - left.activityScore ||
          left.guid.localeCompare(right.guid),
      );
  }

  #sessionCandidates(): readonly SessionCandidate[] {
    const perPlayerIndex = new Map<string, number>();
    return this.#windows
      .filter(
        (window) =>
          window.targetGuids.size > 0 &&
          (window.playerInitiatedActionCount > 0 ||
            this.#options.includeIncidental),
      )
      .sort((left, right) => {
        const timeOrder =
          left.startTime.localTimeTicks - right.startTime.localTimeTicks;
        return timeOrder === 0n
          ? left.playerGuid.localeCompare(right.playerGuid)
          : timeOrder < 0n
            ? -1
            : 1;
      })
      .map((window): SessionCandidate => {
        const index = (perPlayerIndex.get(window.playerGuid) ?? 0) + 1;
        perPlayerIndex.set(window.playerGuid, index);
        const duration =
          window.endTime.localTimeTicks - window.startTime.localTimeTicks;
        const assessment = this.#confidence(window, duration);
        const targetGuids = [...window.targetGuids].sort();
        const firstTarget = targetGuids[0];
        if (firstTarget === undefined) {
          throw new Error(
            "A discovery window must retain at least one target.",
          );
        }
        return {
          id: `${window.playerGuid}-session-${String(index)}`,
          playerGuid: window.playerGuid,
          targetGuids: [firstTarget, ...targetGuids.slice(1)],
          startTime: window.startTime,
          endTime: window.endTime,
          durationTicks: duration,
          confidence: assessment.confidence,
          reasons: assessment.reasons,
          qualifyingActionCount: window.qualifyingActionCount,
          playerInitiatedActionCount: window.playerInitiatedActionCount,
        };
      });
  }

  #confidence(
    window: CandidateWindow,
    duration: bigint,
  ): { confidence: SessionConfidence; reasons: readonly ConfidenceReason[] } {
    const reasons: ConfidenceReason[] = [];
    const durationMs = Number(duration) / 10;
    if (window.playerInitiatedActionCount === 0) {
      reasons.push({
        code: "PASSIVE_OR_OWNED_ACTIVITY_ONLY",
        description:
          "Only passive, periodic, or controlled-entity activity was observed.",
      });
      return { confidence: "incidental", reasons };
    }
    reasons.push({
      code: "PLAYER_INTENT_PRESENT",
      description: "The player performed an explicit hostile action.",
    });
    if (
      window.playerInitiatedActionCount >=
      this.#options.likelyMinimumPlayerInitiatedActions
    ) {
      reasons.push({
        code: "MULTIPLE_PLAYER_ACTIONS",
        description:
          "Multiple explicit player-initiated hostile actions were observed.",
      });
    }
    if (durationMs >= this.#options.likelyMinimumDurationMs) {
      reasons.push({
        code: "MINIMUM_DURATION_MET",
        description: "The activity met the configured likely-attempt duration.",
      });
    } else {
      reasons.push({
        code: "SHORT_DURATION",
        description:
          "The activity was shorter than the configured likely-attempt duration.",
      });
    }
    if (
      window.qualifyingActionCount >=
      this.#options.likelyMinimumQualifyingActions
    ) {
      reasons.push({
        code: "SUSTAINED_ACTIVITY",
        description:
          "Qualifying hostile activity was sustained across the window.",
      });
    } else {
      reasons.push({
        code: "SPARSE_ACTIVITY",
        description:
          "The activity contained only a small number of qualifying actions.",
      });
    }
    reasons.push({
      code: "NON_PLAYER_TARGET",
      description: "The affected target has a non-player creature GUID type.",
    });
    if (window.targetGuids.size > 1) {
      reasons.push({
        code: "MULTI_TARGET",
        description:
          "The activity affected multiple targets in one continuous window.",
      });
    }
    const likely =
      durationMs >= this.#options.likelyMinimumDurationMs &&
      window.playerInitiatedActionCount >=
        this.#options.likelyMinimumPlayerInitiatedActions &&
      window.qualifyingActionCount >=
        this.#options.likelyMinimumQualifyingActions;
    return { confidence: likely ? "likely" : "possible", reasons };
  }
}

function consumeLine(
  scanner: DiscoveryScanner,
  line: DecodedLine,
): OperationResult<undefined> {
  if (line.raw.length === 0)
    return { ok: true, value: undefined, warnings: [] };
  const parsed = parseRawRecord(line.raw, line.location, line.lineTerminator);
  if (!parsed.ok) return parsed;
  return scanner.consume(parsed.value);
}

export async function discoverCombatLogChunks(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  file: InputFileMetadata,
  options: DiscoveryScanOptions = {},
): Promise<OperationResult<DiscoveryResult>> {
  const resolved = resolveOptions(options);
  if (!resolved.ok) return resolved;
  const scanner = new DiscoveryScanner(
    file,
    resolved.value,
    options.registry,
    options.manualSchemaId,
  );
  const decoder = new IncrementalLineDecoder();
  let bytesProcessed = 0;

  try {
    for await (const chunk of chunks) {
      if (options.shouldAbort?.() === true) {
        return { ok: false, error: cancelledError(), warnings: [] };
      }
      const decoded = decoder.push(chunk);
      if (!decoded.ok) return decoded;
      for (const line of decoded.value) {
        const consumed = consumeLine(scanner, line);
        if (!consumed.ok) return consumed;
      }
      bytesProcessed += chunk.byteLength;
      options.onBytesProcessed?.(bytesProcessed);
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        ...appError(
          "file-unreadable",
          "BYTE_STREAM_FAILED",
          "The combat-log byte stream could not be read.",
          "Try choosing the source file again.",
        ),
        technicalDetails: {
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
      warnings: [],
    };
  }

  if (options.shouldAbort?.() === true) {
    return { ok: false, error: cancelledError(), warnings: [] };
  }
  const finalLines = decoder.finish();
  if (!finalLines.ok) return finalLines;
  for (const line of finalLines.value) {
    const consumed = consumeLine(scanner, line);
    if (!consumed.ok) return consumed;
  }
  return scanner.finish();
}

export function discoverCombatLogText(
  text: string,
  file: InputFileMetadata = {
    name: "compact-fixture.log",
    sizeBytes: new TextEncoder().encode(text).byteLength,
  },
  options: DiscoveryScanOptions = {},
): Promise<OperationResult<DiscoveryResult>> {
  return discoverCombatLogChunks(
    [new TextEncoder().encode(text)],
    file,
    options,
  );
}
