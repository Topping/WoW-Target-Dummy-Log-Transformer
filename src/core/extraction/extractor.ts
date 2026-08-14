import type {
  Actor,
  ActorReference,
  AppError,
  CombatEvent,
  FilteringDebugDecision,
  FilteringKeepReason,
  FilteringRemoveReason,
  InputFileMetadata,
  NonEmptyReadonlyArray,
  OperationResult,
  OwnershipConflictWarning,
  OwnershipEvidence,
  ParserMetadata,
  ParserWarning,
  RawCombatLogRecord,
  RawTimestamp,
  Session,
  SessionExtractionBudgets,
  SessionExtractionOptions,
  SessionSelection,
  SessionTargetStatistics,
} from "../contracts";
import { actorReference, classifyActorGuid } from "../parser/actors";
import { parserWarning } from "../parser/diagnostics";
import { IncrementalLineDecoder, type DecodedLine } from "../parser/lineReader";
import { PARSER_VERSION } from "../parser/parser";
import { parseRawRecord } from "../parser/rawRecord";
import {
  defaultSchemaRegistry,
  parseCombatLogVersion,
  type CombatLogSchema,
  type CombatLogSchemaRegistry,
} from "../parser/schema";
import { parseTimestamp } from "../parser/timestamp";

const TICKS_PER_MILLISECOND = 10n;
const AFFILIATION_MINE = 0x1;

export const DEFAULT_SESSION_EXTRACTION_OPTIONS = {
  preRollMs: 5_000,
  postRollMs: 5_000,
  includeDebugDecisions: false,
} as const;

/**
 * D10 defaults measured against the approved real captures. They are safety
 * boundaries for retained session data, not promises about source-file size.
 */
export const DEFAULT_SESSION_EXTRACTION_BUDGETS: Readonly<SessionExtractionBudgets> =
  {
    softRetainedEventLimit: 25_000,
    hardRetainedEventLimit: 50_000,
    softEstimatedByteLimit: 16 * 1024 * 1024,
    hardEstimatedByteLimit: 32 * 1024 * 1024,
  };

export interface SessionExtractionRuntimeOptions extends SessionExtractionOptions {
  readonly registry?: CombatLogSchemaRegistry;
  readonly manualSchemaId?: string;
  readonly shouldAbort?: () => boolean;
  readonly onBytesProcessed?: (bytesProcessed: number) => void;
  readonly onPhase?: (
    phase: "filtering-events" | "building-result",
    bytesProcessed: number,
  ) => void;
}

interface ResolvedExtractionOptions {
  readonly preRollMs: number;
  readonly postRollMs: number;
  readonly budgets: SessionExtractionBudgets;
  readonly includeDebugDecisions: boolean;
}

interface ActorObservation {
  guid: string;
  name?: string;
  flags?: string;
  raidFlags?: string;
}

interface OwnershipClaim {
  readonly entityGuid: string;
  readonly ownerGuid: string;
  readonly evidence: OwnershipEvidence;
  readonly strength: number;
  readonly lineNumber: number;
}

interface OwnershipResolution {
  readonly claims: ReadonlyMap<string, OwnershipClaim>;
  readonly evidence: ReadonlyMap<string, ReadonlySet<OwnershipEvidence>>;
  readonly warnings: readonly ParserWarning[];
}

interface WindowReadResult {
  readonly records: readonly RawCombatLogRecord[];
  readonly skippedBeforePreRollCount: number;
  readonly stoppedAfterPostRoll: boolean;
  readonly bytesRead: number;
  readonly parser: ParserMetadata;
  readonly schema: CombatLogSchema;
  readonly warnings: readonly ParserWarning[];
}

interface FilterAssessment {
  readonly keep: boolean;
  readonly reason: FilteringKeepReason | FilteringRemoveReason;
  readonly externalEffect: boolean;
}

function extractionError(
  category: AppError["category"],
  code: string,
  message: string,
  suggestedAction: string,
  details?: Readonly<Record<string, unknown>>,
): AppError {
  return {
    category,
    code,
    message,
    recoverable: true,
    suggestedAction,
    ...(details === undefined ? {} : { technicalDetails: { details } }),
  };
}

function cancelledError(): AppError {
  return extractionError(
    "cancelled",
    "OPERATION_CANCELLED",
    "Processing was cancelled.",
    "Start a new operation when you are ready.",
  );
}

function isNonNegativeFinite(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

function resolveOptions(
  options: SessionExtractionOptions,
): OperationResult<ResolvedExtractionOptions> {
  const resolved: ResolvedExtractionOptions = {
    preRollMs:
      options.preRollMs ?? DEFAULT_SESSION_EXTRACTION_OPTIONS.preRollMs,
    postRollMs:
      options.postRollMs ?? DEFAULT_SESSION_EXTRACTION_OPTIONS.postRollMs,
    budgets: options.budgets ?? DEFAULT_SESSION_EXTRACTION_BUDGETS,
    includeDebugDecisions:
      options.includeDebugDecisions ??
      DEFAULT_SESSION_EXTRACTION_OPTIONS.includeDebugDecisions,
  };
  const budgetValues = [
    resolved.budgets.softRetainedEventLimit,
    resolved.budgets.hardRetainedEventLimit,
    resolved.budgets.softEstimatedByteLimit,
    resolved.budgets.hardEstimatedByteLimit,
  ];
  const valid =
    isNonNegativeFinite(resolved.preRollMs) &&
    isNonNegativeFinite(resolved.postRollMs) &&
    budgetValues.every(isNonNegativeFinite) &&
    budgetValues.every(
      (value) => value === undefined || Number.isSafeInteger(value),
    ) &&
    (resolved.budgets.softRetainedEventLimit === undefined ||
      resolved.budgets.hardRetainedEventLimit === undefined ||
      resolved.budgets.softRetainedEventLimit <=
        resolved.budgets.hardRetainedEventLimit) &&
    (resolved.budgets.softEstimatedByteLimit === undefined ||
      resolved.budgets.hardEstimatedByteLimit === undefined ||
      resolved.budgets.softEstimatedByteLimit <=
        resolved.budgets.hardEstimatedByteLimit);
  if (!valid) {
    return {
      ok: false,
      error: extractionError(
        "internal",
        "INVALID_SESSION_EXTRACTION_OPTIONS",
        "The detailed-processing settings are invalid.",
        "Restore the default extraction settings and try again.",
      ),
      warnings: [],
    };
  }
  return { ok: true, value: resolved, warnings: [] };
}

function validateSelection(
  selection: SessionSelection,
): OperationResult<undefined> {
  if (
    selection.targetGuids.length === 0 ||
    selection.endTime.localTimeTicks < selection.startTime.localTimeTicks
  ) {
    return {
      ok: false,
      error: extractionError(
        "no-training-sessions",
        "INVALID_SESSION_SELECTION",
        "The selected session has invalid boundaries or no targets.",
        "Return to session selection and choose the attempt again.",
      ),
      warnings: [],
    };
  }
  return { ok: true, value: undefined, warnings: [] };
}

function timestampFromLine(line: DecodedLine): OperationResult<RawTimestamp> {
  const delimiter = line.raw.indexOf("  ");
  if (delimiter <= 0) {
    return {
      ok: false,
      error: extractionError(
        "unsupported-log-format",
        "MALFORMED_RECORD",
        "This line does not have a combat-log timestamp and payload.",
        "Keep the source log and report this line so the format can be supported.",
        { lineNumber: line.location.lineNumber, rawLine: line.raw },
      ),
      warnings: [],
    };
  }
  return parseTimestamp(line.raw.slice(0, delimiter), line.location, line.raw);
}

function isVersionLine(line: DecodedLine): boolean {
  return line.raw.includes("  COMBAT_LOG_VERSION,");
}

async function readSelectedWindow(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  selection: SessionSelection,
  options: ResolvedExtractionOptions,
  runtime: Pick<
    SessionExtractionRuntimeOptions,
    "registry" | "manualSchemaId" | "shouldAbort" | "onBytesProcessed"
  >,
): Promise<OperationResult<WindowReadResult>> {
  const decoder = new IncrementalLineDecoder();
  const records: RawCombatLogRecord[] = [];
  const warnings: ParserWarning[] = [];
  const preRollStart =
    selection.startTime.localTimeTicks -
    BigInt(Math.trunc(options.preRollMs)) * TICKS_PER_MILLISECOND;
  const postRollEnd =
    selection.endTime.localTimeTicks +
    BigInt(Math.trunc(options.postRollMs)) * TICKS_PER_MILLISECOND;
  const registry = runtime.registry ?? defaultSchemaRegistry;
  let schema: CombatLogSchema | undefined;
  let parser: ParserMetadata | undefined;
  let skippedBeforePreRollCount = 0;
  let stoppedAfterPostRoll = false;
  let bytesRead = 0;

  const selectVersion = (
    record: RawCombatLogRecord,
  ): OperationResult<undefined> => {
    const version = parseCombatLogVersion(record);
    if (!version.ok) return version;
    const selected = registry.select(version.value, {
      ...(runtime.manualSchemaId === undefined
        ? {}
        : { manualSchemaId: runtime.manualSchemaId }),
    });
    if (!selected.ok) return selected;
    schema = selected.value.schema;
    parser = {
      parserVersion: PARSER_VERSION,
      schema: {
        id: schema.id,
        selection: selected.value.selection,
        detectedVersion: version.value,
      },
    };
    warnings.push(...selected.warnings);
    return { ok: true, value: undefined, warnings: [] };
  };

  const consumeLine = (
    line: DecodedLine,
  ): OperationResult<"continue" | "stop"> => {
    if (runtime.shouldAbort?.() === true) {
      return { ok: false, error: cancelledError(), warnings: [] };
    }
    if (line.raw.length === 0)
      return { ok: true, value: "continue", warnings: [] };
    const timestamp = timestampFromLine(line);
    if (!timestamp.ok) return timestamp;

    if (timestamp.value.localTimeTicks > postRollEnd) {
      return { ok: true, value: "stop", warnings: [] };
    }
    if (isVersionLine(line)) {
      const versionRecord = parseRawRecord(
        line.raw,
        line.location,
        line.lineTerminator,
      );
      if (!versionRecord.ok) return versionRecord;
      const selected = selectVersion(versionRecord.value);
      if (!selected.ok) return selected;
      // The log-version record is required to make filtered raw output standalone.
      records.push(versionRecord.value);
      return { ok: true, value: "continue", warnings: [] };
    }
    if (timestamp.value.localTimeTicks < preRollStart) {
      skippedBeforePreRollCount += 1;
      return { ok: true, value: "continue", warnings: [] };
    }
    const parsed = parseRawRecord(line.raw, line.location, line.lineTerminator);
    if (!parsed.ok) return parsed;
    records.push(parsed.value);
    return { ok: true, value: "continue", warnings: [] };
  };

  try {
    let stop = false;
    for await (const chunk of chunks) {
      if (runtime.shouldAbort?.() === true) {
        return { ok: false, error: cancelledError(), warnings };
      }
      bytesRead += chunk.byteLength;
      runtime.onBytesProcessed?.(bytesRead);
      const decoded = decoder.push(chunk);
      if (!decoded.ok)
        return { ...decoded, warnings: [...warnings, ...decoded.warnings] };
      for (const line of decoded.value) {
        const consumed = consumeLine(line);
        if (!consumed.ok)
          return { ...consumed, warnings: [...warnings, ...consumed.warnings] };
        if (consumed.value === "stop") {
          stoppedAfterPostRoll = true;
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: extractionError(
        "file-unreadable",
        "BYTE_STREAM_FAILED",
        "The combat-log byte stream could not be read.",
        "Try choosing the source file again.",
        { cause: error instanceof Error ? error.message : String(error) },
      ),
      warnings,
    };
  }

  if (!stoppedAfterPostRoll) {
    const final = decoder.finish();
    if (!final.ok)
      return { ...final, warnings: [...warnings, ...final.warnings] };
    for (const line of final.value) {
      const consumed = consumeLine(line);
      if (!consumed.ok)
        return { ...consumed, warnings: [...warnings, ...consumed.warnings] };
      if (consumed.value === "stop") {
        stoppedAfterPostRoll = true;
        break;
      }
    }
  }
  if (runtime.shouldAbort?.() === true) {
    return { ok: false, error: cancelledError(), warnings };
  }
  if (schema === undefined || parser === undefined) {
    return {
      ok: false,
      error: extractionError(
        "invalid-combat-log",
        "MISSING_LOG_VERSION",
        "The input does not contain a combat-log version record.",
        "Choose the complete WoWCombatLog.txt file.",
      ),
      warnings,
    };
  }
  return {
    ok: true,
    value: {
      records,
      skippedBeforePreRollCount,
      stoppedAfterPostRoll,
      bytesRead,
      parser,
      schema,
      warnings,
    },
    warnings,
  };
}

function parseFlags(flags: string | undefined): number {
  if (flags === undefined) return 0;
  const value = Number.parseInt(flags, flags.startsWith("0x") ? 16 : 10);
  return Number.isFinite(value) ? value : 0;
}

function isRealGuid(guid: string | undefined): guid is string {
  return (
    guid !== undefined &&
    guid !== "nil" &&
    guid !== "0000000000000000" &&
    guid.length > 0
  );
}

function rawActors(record: RawCombatLogRecord): {
  readonly source?: ActorReference;
  readonly destination?: ActorReference;
} {
  const fields = record.fields;
  const sourceGuid = fields[1]?.value;
  const destinationGuid = fields[5]?.value;
  const sourceFlags = fields[3]?.value;
  const destinationFlags = fields[7]?.value;
  return {
    ...(isRealGuid(sourceGuid) && sourceFlags?.startsWith("0x") === true
      ? {
          source: actorReference(
            sourceGuid,
            fields[2]?.value,
            sourceFlags,
            fields[4]?.value,
          ),
        }
      : {}),
    ...(isRealGuid(destinationGuid) &&
    destinationFlags?.startsWith("0x") === true
      ? {
          destination: actorReference(
            destinationGuid,
            fields[6]?.value,
            destinationFlags,
            fields[8]?.value,
          ),
        }
      : {}),
  };
}

function observeActor(
  observations: Map<string, ActorObservation>,
  actor: ActorReference | undefined,
): void {
  if (actor === undefined || !isRealGuid(actor.guid)) return;
  const existing = observations.get(actor.guid);
  if (existing === undefined) {
    observations.set(actor.guid, {
      guid: actor.guid,
      ...(actor.name === undefined ? {} : { name: actor.name }),
      ...(actor.flags === undefined ? {} : { flags: actor.flags }),
      ...(actor.raidFlags === undefined ? {} : { raidFlags: actor.raidFlags }),
    });
    return;
  }
  if (actor.name !== undefined) existing.name = actor.name;
  if (actor.flags !== undefined) existing.flags = actor.flags;
  if (actor.raidFlags !== undefined) existing.raidFlags = actor.raidFlags;
}

function evidenceStrength(evidence: OwnershipEvidence): number {
  switch (evidence) {
    case "advanced-owner-guid":
      return 3;
    case "summon":
    case "create":
      return 2;
    case "affiliation-mine":
      return 1;
  }
}

function ownershipConflictWarning(
  winning: OwnershipClaim,
  conflicting: OwnershipClaim,
): OwnershipConflictWarning {
  return parserWarning(
    "OWNERSHIP_CONFLICT",
    `Ownership evidence for '${winning.entityGuid}' disagrees; ${winning.evidence} ownership by '${winning.ownerGuid}' was retained over ${conflicting.evidence} ownership by '${conflicting.ownerGuid}'.`,
    {
      location: { lineNumber: conflicting.lineNumber },
      details: {
        entityGuid: winning.entityGuid,
        winningEvidence: {
          ownerGuid: winning.ownerGuid,
          evidence: winning.evidence,
          lineNumber: winning.lineNumber,
        },
        conflictingEvidence: {
          ownerGuid: conflicting.ownerGuid,
          evidence: conflicting.evidence,
          lineNumber: conflicting.lineNumber,
        },
      },
    },
  ) as OwnershipConflictWarning;
}

function resolveOwnership(
  records: readonly RawCombatLogRecord[],
  selectedPlayerGuid: string,
  observations: Map<string, ActorObservation>,
): OwnershipResolution {
  const claims = new Map<string, OwnershipClaim>();
  const evidence = new Map<string, Set<OwnershipEvidence>>();
  const warnings: ParserWarning[] = [];

  const claim = (
    entityGuid: string,
    ownerGuid: string,
    kind: OwnershipEvidence,
    lineNumber: number,
  ): void => {
    if (
      !isRealGuid(entityGuid) ||
      !isRealGuid(ownerGuid) ||
      entityGuid === ownerGuid ||
      classifyActorGuid(entityGuid) === "player"
    ) {
      return;
    }
    const candidate: OwnershipClaim = {
      entityGuid,
      ownerGuid,
      evidence: kind,
      strength: evidenceStrength(kind),
      lineNumber,
    };
    const existing = claims.get(entityGuid);
    if (existing === undefined) {
      claims.set(entityGuid, candidate);
      evidence.set(entityGuid, new Set([kind]));
      return;
    }
    if (existing.ownerGuid === ownerGuid) {
      evidence.get(entityGuid)?.add(kind);
      if (candidate.strength > existing.strength)
        claims.set(entityGuid, candidate);
      return;
    }
    const candidateWins = candidate.strength > existing.strength;
    const winning = candidateWins ? candidate : existing;
    const conflicting = candidateWins ? existing : candidate;
    warnings.push(ownershipConflictWarning(winning, conflicting));
    if (candidateWins) {
      claims.set(entityGuid, candidate);
      evidence.set(entityGuid, new Set([kind]));
    }
  };

  for (const record of records) {
    const actors = rawActors(record);
    observeActor(observations, actors.source);
    observeActor(observations, actors.destination);
    for (const actor of [actors.source, actors.destination]) {
      if (
        actor !== undefined &&
        actor.type !== "player" &&
        (parseFlags(actor.flags) & AFFILIATION_MINE) !== 0
      ) {
        claim(
          actor.guid,
          selectedPlayerGuid,
          "affiliation-mine",
          record.location.lineNumber,
        );
      }
    }
    if (
      actors.source !== undefined &&
      actors.destination !== undefined &&
      (record.eventType === "SPELL_SUMMON" ||
        record.eventType === "SPELL_CREATE")
    ) {
      claim(
        actors.destination.guid,
        actors.source.guid,
        record.eventType === "SPELL_CREATE" ? "create" : "summon",
        record.location.lineNumber,
      );
    }

    const possibleEntities = new Set(
      [actors.source?.guid, actors.destination?.guid].filter(isRealGuid),
    );
    for (let index = 9; index + 1 < record.fields.length; index += 1) {
      const entityGuid = record.fields[index]?.value;
      const ownerGuid = record.fields[index + 1]?.value;
      if (
        isRealGuid(entityGuid) &&
        isRealGuid(ownerGuid) &&
        possibleEntities.has(entityGuid)
      ) {
        observeActor(
          observations,
          actorReference(ownerGuid, undefined, undefined, undefined),
        );
        claim(
          entityGuid,
          ownerGuid,
          "advanced-owner-guid",
          record.location.lineNumber,
        );
      }
    }
  }
  return { claims, evidence, warnings };
}

function ownedBySelected(
  guid: string,
  selectedPlayerGuid: string,
  claims: ReadonlyMap<string, OwnershipClaim>,
): boolean {
  const visited = new Set<string>();
  let current = guid;
  while (!visited.has(current)) {
    visited.add(current);
    const owner = claims.get(current)?.ownerGuid;
    if (owner === undefined) return false;
    if (owner === selectedPlayerGuid) return true;
    current = owner;
  }
  return false;
}

function removeReason(
  source: ActorReference | undefined,
  destination: ActorReference | undefined,
): FilteringRemoveReason {
  if (source?.type === "player" || destination?.type === "player")
    return "unrelated-player-activity";
  if (
    source?.type === "creature" ||
    source?.type === "pet" ||
    source?.type === "guardian" ||
    destination?.type === "creature" ||
    destination?.type === "pet" ||
    destination?.type === "guardian"
  ) {
    return "unrelated-creature-activity";
  }
  return "unrelated-record";
}

function assessRecord(
  eventType: string,
  source: ActorReference | undefined,
  destination: ActorReference | undefined,
  playerGuid: string,
  ownedGuids: ReadonlySet<string>,
  targetGuids: ReadonlySet<string>,
  combatantGuid: string | undefined,
): FilterAssessment {
  const sourcePrimary = source?.guid === playerGuid;
  const sourceOwned = source !== undefined && ownedGuids.has(source.guid);
  const destinationPrimary = destination?.guid === playerGuid;
  const destinationOwned =
    destination !== undefined && ownedGuids.has(destination.guid);

  if (sourcePrimary)
    return { keep: true, reason: "primary-outgoing", externalEffect: false };
  if (sourceOwned)
    return {
      keep: true,
      reason: "owned-entity-outgoing",
      externalEffect: false,
    };
  if (destinationPrimary) {
    const externalEffect =
      source !== undefined && !targetGuids.has(source.guid);
    return {
      keep: true,
      reason: "primary-incoming",
      externalEffect,
    };
  }
  if (destinationOwned) {
    const externalEffect =
      source !== undefined && !targetGuids.has(source.guid);
    return {
      keep: true,
      reason: "owned-entity-incoming",
      externalEffect,
    };
  }
  if (
    ["UNIT_DIED", "UNIT_DESTROYED"].includes(eventType) &&
    destination !== undefined &&
    targetGuids.has(destination.guid)
  ) {
    return {
      keep: true,
      reason: "selected-target-metadata",
      externalEffect: false,
    };
  }
  if (
    eventType === "COMBAT_LOG_VERSION" ||
    eventType === "ENCOUNTER_START" ||
    eventType === "ENCOUNTER_END" ||
    (eventType === "COMBATANT_INFO" &&
      combatantGuid !== undefined &&
      (combatantGuid === playerGuid || ownedGuids.has(combatantGuid)))
  ) {
    return { keep: true, reason: "required-metadata", externalEffect: false };
  }
  return {
    keep: false,
    reason: removeReason(source, destination),
    externalEffect: false,
  };
}

function emptyKeepCounts(): Record<FilteringKeepReason, number> {
  return {
    "primary-outgoing": 0,
    "owned-entity-outgoing": 0,
    "primary-incoming": 0,
    "owned-entity-incoming": 0,
    "selected-target-metadata": 0,
    "required-metadata": 0,
  };
}

function emptyRemoveCounts(): Record<FilteringRemoveReason, number> {
  return {
    "unrelated-player-activity": 0,
    "unrelated-creature-activity": 0,
    "unrelated-record": 0,
  };
}

function retainedSourceBytes(record: RawCombatLogRecord): number {
  return new TextEncoder().encode(record.raw + record.lineTerminator)
    .byteLength;
}

function hardBudgetError(
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): AppError {
  return extractionError(
    "session-too-large",
    code,
    message,
    "Choose a narrower session or explicitly retry with a higher Advanced limit.",
    details,
  );
}

function observedDamageAmount(record: RawCombatLogRecord): number {
  if (
    ![
      "SPELL_DAMAGE",
      "SPELL_PERIODIC_DAMAGE",
      "RANGE_DAMAGE",
      "SWING_DAMAGE",
    ].includes(record.eventType)
  ) {
    return 0;
  }
  const index = record.eventType === "SWING_DAMAGE" ? 9 : 12;
  const value = record.fields[index]?.value;
  const amount = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function actorFromObservation(
  guid: string,
  relationship: Actor["relationship"],
  observations: ReadonlyMap<string, ActorObservation>,
  ownership: OwnershipResolution,
): Actor {
  const observed = observations.get(guid);
  const claim = ownership.claims.get(guid);
  const evidence = ownership.evidence.get(guid);
  return {
    guid,
    ...(observed?.name === undefined ? {} : { name: observed.name }),
    ...(observed?.flags === undefined ? {} : { flags: observed.flags }),
    ...(observed?.raidFlags === undefined
      ? {}
      : { raidFlags: observed.raidFlags }),
    type: classifyActorGuid(guid),
    relationship,
    ...(relationship !== "owned-by-primary" || claim === undefined
      ? {}
      : { ownerGuid: claim.ownerGuid }),
    ...(relationship !== "owned-by-primary" || evidence === undefined
      ? {}
      : { ownershipEvidence: [...evidence].sort() }),
  };
}

export async function extractSessionChunks(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  file: InputFileMetadata,
  selection: SessionSelection,
  options: SessionExtractionRuntimeOptions = {},
): Promise<OperationResult<Session>> {
  const selectionValidation = validateSelection(selection);
  if (!selectionValidation.ok) return selectionValidation;
  const resolved = resolveOptions(options);
  if (!resolved.ok) return resolved;
  const window = await readSelectedWindow(
    chunks,
    selection,
    resolved.value,
    options,
  );
  if (!window.ok) return window;
  if (
    !window.value.stoppedAfterPostRoll &&
    window.value.bytesRead !== file.sizeBytes
  ) {
    return {
      ok: false,
      error: extractionError(
        "file-unreadable",
        "INCOMPLETE_BYTE_STREAM",
        "The selected file ended before all expected bytes were read.",
        "Choose the file again or make a new copy of it.",
        {
          expectedBytes: file.sizeBytes,
          processedBytes: window.value.bytesRead,
        },
      ),
      warnings: window.value.warnings,
    };
  }

  const observations = new Map<string, ActorObservation>();
  observeActor(
    observations,
    actorReference(selection.playerGuid, undefined, undefined, undefined),
  );
  for (const targetGuid of selection.targetGuids) {
    observeActor(
      observations,
      actorReference(targetGuid, undefined, undefined, undefined),
    );
  }
  const ownership = resolveOwnership(
    window.value.records,
    selection.playerGuid,
    observations,
  );
  options.onPhase?.("filtering-events", window.value.bytesRead);
  const ownedGuids = new Set(
    [...ownership.claims.keys()].filter((guid) =>
      ownedBySelected(guid, selection.playerGuid, ownership.claims),
    ),
  );
  const targetGuidSet = new Set(selection.targetGuids);
  const warnings = [...window.value.warnings, ...ownership.warnings];
  const keptByReason = emptyKeepCounts();
  const removedByReason = emptyRemoveCounts();
  const events: CombatEvent[] = [];
  const debugDecisions: FilteringDebugDecision[] = [];
  const includedActorGuids = new Set<string>([
    selection.playerGuid,
    ...selection.targetGuids,
    ...ownedGuids,
  ]);
  const targetStats = new Map<string, SessionTargetStatistics>(
    selection.targetGuids.map((targetGuid) => [
      targetGuid,
      {
        targetGuid,
        relevantEventCount: 0,
        outgoingEventCount: 0,
        incomingEventCount: 0,
        damageEventCount: 0,
        observedDamageAmount: 0,
      },
    ]),
  );
  let removedCount = 0;
  let externalEffectCount = 0;
  let unknownEventTypeCount = 0;
  let estimatedRetainedBytes = 0;
  let softEventWarned = false;
  let softByteWarned = false;

  for (const record of window.value.records) {
    if (options.shouldAbort?.() === true) {
      return { ok: false, error: cancelledError(), warnings };
    }
    const normalized = window.value.schema.normalize(record, {
      parserVersion: PARSER_VERSION,
      firstTimestampTicks: selection.startTime.localTimeTicks,
      origin: "combat-log",
    });
    if (!normalized.ok)
      return {
        ...normalized,
        warnings: [...warnings, ...normalized.warnings],
      };
    warnings.push(...normalized.warnings);
    const event = normalized.value;
    const actors = rawActors(record);
    observeActor(observations, actors.source);
    observeActor(observations, actors.destination);
    const source = event.source ?? actors.source;
    const destination = event.destination ?? actors.destination;
    const assessment = assessRecord(
      event.type,
      source,
      destination,
      selection.playerGuid,
      ownedGuids,
      targetGuidSet,
      event.payload.combatantGuid,
    );
    if (options.includeDebugDecisions === true) {
      debugDecisions.push({
        lineNumber: event.location.lineNumber,
        timestamp: event.timestamp,
        relativeTimeTicks: event.relativeTimeTicks,
        eventType: event.type,
        decision: assessment.keep ? "kept" : "removed",
        reason: assessment.reason,
        ...(source === undefined ? {} : { sourceGuid: source.guid }),
        ...(destination === undefined
          ? {}
          : { destinationGuid: destination.guid }),
      });
    }
    if (!assessment.keep) {
      removedCount += 1;
      removedByReason[assessment.reason as FilteringRemoveReason] += 1;
      continue;
    }

    const nextEventCount = events.length + 1;
    const nextEstimatedBytes =
      estimatedRetainedBytes + retainedSourceBytes(record);
    const budgets = resolved.value.budgets;
    if (
      budgets.hardRetainedEventLimit !== undefined &&
      nextEventCount > budgets.hardRetainedEventLimit
    ) {
      return {
        ok: false,
        error: hardBudgetError(
          "SESSION_HARD_EVENT_LIMIT_EXCEEDED",
          "The selected session exceeds the configured retained-event limit.",
          {
            limit: budgets.hardRetainedEventLimit,
            attemptedRetainedEventCount: nextEventCount,
          },
        ),
        warnings,
      };
    }
    if (
      budgets.hardEstimatedByteLimit !== undefined &&
      nextEstimatedBytes > budgets.hardEstimatedByteLimit
    ) {
      return {
        ok: false,
        error: hardBudgetError(
          "SESSION_HARD_BYTE_LIMIT_EXCEEDED",
          "The selected session exceeds the configured retained-byte estimate.",
          {
            limit: budgets.hardEstimatedByteLimit,
            attemptedEstimatedBytes: nextEstimatedBytes,
          },
        ),
        warnings,
      };
    }
    if (
      !softEventWarned &&
      budgets.softRetainedEventLimit !== undefined &&
      nextEventCount > budgets.softRetainedEventLimit
    ) {
      softEventWarned = true;
      warnings.push(
        parserWarning(
          "SESSION_SOFT_EVENT_LIMIT_EXCEEDED",
          "The selected session is larger than the configured retained-event warning threshold; processing continued without truncation.",
          {
            details: {
              limit: budgets.softRetainedEventLimit,
              retainedEventCount: nextEventCount,
            },
          },
        ),
      );
    }
    if (
      !softByteWarned &&
      budgets.softEstimatedByteLimit !== undefined &&
      nextEstimatedBytes > budgets.softEstimatedByteLimit
    ) {
      softByteWarned = true;
      warnings.push(
        parserWarning(
          "SESSION_SOFT_BYTE_LIMIT_EXCEEDED",
          "The selected session is larger than the configured retained-byte warning threshold; processing continued without truncation.",
          {
            details: {
              limit: budgets.softEstimatedByteLimit,
              estimatedRetainedBytes: nextEstimatedBytes,
            },
          },
        ),
      );
    }

    keptByReason[assessment.reason as FilteringKeepReason] += 1;
    estimatedRetainedBytes = nextEstimatedBytes;
    if (assessment.externalEffect) externalEffectCount += 1;
    if (!event.normalized) unknownEventTypeCount += 1;
    if (source !== undefined) includedActorGuids.add(source.guid);
    if (destination !== undefined) includedActorGuids.add(destination.guid);
    events.push({
      ...event,
      ...(source === undefined ? {} : { source }),
      ...(destination === undefined ? {} : { destination }),
      ...(assessment.externalEffect ? { externalEffect: true } : {}),
    });

    for (const targetGuid of selection.targetGuids) {
      const existing = targetStats.get(targetGuid);
      if (existing === undefined) continue;
      const outgoing =
        destination?.guid === targetGuid &&
        (source?.guid === selection.playerGuid ||
          (source !== undefined && ownedGuids.has(source.guid)));
      const incoming =
        source?.guid === targetGuid &&
        (destination?.guid === selection.playerGuid ||
          (destination !== undefined && ownedGuids.has(destination.guid)));
      const metadata =
        ["UNIT_DIED", "UNIT_DESTROYED"].includes(event.type) &&
        destination?.guid === targetGuid;
      if (!outgoing && !incoming && !metadata) continue;
      targetStats.set(targetGuid, {
        ...existing,
        relevantEventCount: existing.relevantEventCount + 1,
        outgoingEventCount: existing.outgoingEventCount + (outgoing ? 1 : 0),
        incomingEventCount: existing.incomingEventCount + (incoming ? 1 : 0),
        damageEventCount:
          existing.damageEventCount +
          (outgoing &&
          event.family === "damage" &&
          event.type !== "SWING_DAMAGE_LANDED"
            ? 1
            : 0),
        observedDamageAmount:
          existing.observedDamageAmount +
          (outgoing ? observedDamageAmount(record) : 0),
      });
    }
  }

  const targets = selection.targetGuids.map((guid) =>
    actorFromObservation(guid, "target", observations, ownership),
  ) as unknown as NonEmptyReadonlyArray<Actor>;
  const perTarget = selection.targetGuids.map((guid) => {
    const value = targetStats.get(guid);
    if (value === undefined)
      throw new Error("A selected target must have initialized statistics.");
    return value;
  }) as unknown as NonEmptyReadonlyArray<SessionTargetStatistics>;
  const actors = [...includedActorGuids]
    .filter(isRealGuid)
    .map((guid) => {
      const relationship: Actor["relationship"] =
        guid === selection.playerGuid
          ? "primary"
          : targetGuidSet.has(guid)
            ? "target"
            : ownedGuids.has(guid)
              ? "owned-by-primary"
              : "external";
      return actorFromObservation(guid, relationship, observations, ownership);
    })
    .sort((left, right) => {
      const order: Record<Actor["relationship"], number> = {
        primary: 0,
        "owned-by-primary": 1,
        target: 2,
        external: 3,
        unknown: 4,
      };
      return (
        order[left.relationship] - order[right.relationship] ||
        left.guid.localeCompare(right.guid)
      );
    });
  options.onPhase?.("building-result", window.value.bytesRead);
  const player = actors.find((actor) => actor.guid === selection.playerGuid);
  if (player === undefined) {
    return {
      ok: false,
      error: extractionError(
        "internal",
        "PRIMARY_ACTOR_MISSING",
        "The selected player could not be represented in the processed session.",
        "Return to session selection and try again.",
      ),
      warnings,
    };
  }
  const consideredRecordCount = window.value.records.length;
  const session: Session = {
    id: selection.id,
    parser: window.value.parser,
    startTime: selection.startTime,
    endTime: selection.endTime,
    durationTicks:
      selection.endTime.localTimeTicks - selection.startTime.localTimeTicks,
    player,
    targets,
    ...(targets.length === 1 ? { focusTargetGuid: targets[0].guid } : {}),
    actors,
    events,
    warnings,
    statistics: {
      relevantEventCount: events.length,
      removedEventCount: removedCount,
      controlledEntityCount: ownedGuids.size,
      externalEffectCount,
      unknownEventTypeCount,
      targets: perTarget,
      filtering: {
        consideredRecordCount,
        keptRecordCount: events.length,
        removedRecordCount: removedCount,
        keptByReason,
        removedByReason,
        skippedBeforePreRollCount: window.value.skippedBeforePreRollCount,
        stoppedAfterPostRoll: window.value.stoppedAfterPostRoll,
        bytesRead: window.value.bytesRead,
        estimatedRetainedBytes,
      },
    },
    ...(resolved.value.includeDebugDecisions ? { debugDecisions } : {}),
  };
  return { ok: true, value: session, warnings };
}

export function extractSessionText(
  text: string,
  selection: SessionSelection,
  options: SessionExtractionRuntimeOptions = {},
): Promise<OperationResult<Session>> {
  const bytes = new TextEncoder().encode(text);
  return extractSessionChunks(
    [bytes],
    { name: "compact-fixture.log", sizeBytes: bytes.byteLength },
    selection,
    options,
  );
}
