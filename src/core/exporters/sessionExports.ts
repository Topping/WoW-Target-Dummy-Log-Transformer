import type {
  AppError,
  OperationResult,
  ParserWarning,
  SerializedSessionExport,
  Session,
  SessionExportKind,
  SessionExportOptions,
  SessionExportSizeLimits,
} from "../contracts";
import { parserWarning } from "../parser/diagnostics";
import {
  WOWCOACH_REFERENCE_BOSS_GUID,
  WOWCOACH_REFERENCE_COMBATANT_GUID,
  WOWCOACH_REFERENCE_COMBATANT_INFO,
  WOWCOACH_REFERENCE_ENCOUNTER,
} from "./wowCoachReference";

export const SESSION_JSON_FORMAT = "wow-training-dummy-session";
export const SESSION_JSON_VERSION = 1;
export const DEFAULT_SESSION_EXPORT_SIZE_LIMITS: Readonly<SessionExportSizeLimits> =
  {
    softByteLimit: 128 * 1024 * 1024,
    hardByteLimit: 256 * 1024 * 1024,
  };

const TICK_KEYS = new Set([
  "localTimeTicks",
  "relativeTimeTicks",
  "durationTicks",
]);
const TICK_PATTERN = /^-?[0-9]+$/u;

interface SessionJsonDocument {
  readonly format: typeof SESSION_JSON_FORMAT;
  readonly version: typeof SESSION_JSON_VERSION;
  readonly session: Session;
}

function exportError(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AppError {
  return {
    category: "session-too-large",
    code,
    message,
    recoverable: true,
    suggestedAction:
      "Retry with a higher explicit Advanced export limit or choose a narrower session.",
    ...(details === undefined ? {} : { technicalDetails: { details } }),
  };
}

function validateLimits(
  options: SessionExportOptions,
): OperationResult<undefined> {
  const soft = options.sizeLimits?.softByteLimit;
  const hard = options.sizeLimits?.hardByteLimit;
  const validValue = (value: number | undefined): boolean =>
    value === undefined ||
    (Number.isSafeInteger(value) && Number.isFinite(value) && value >= 0);
  if (
    !validValue(soft) ||
    !validValue(hard) ||
    (soft !== undefined && hard !== undefined && soft > hard)
  ) {
    return {
      ok: false,
      error: {
        category: "internal",
        code: "INVALID_EXPORT_OPTIONS",
        message: "The export size settings are invalid.",
        recoverable: true,
        suggestedAction: "Restore the default export settings and try again.",
      },
      warnings: [],
    };
  }
  return { ok: true, value: undefined, warnings: [] };
}

function resolveExportOptions(
  options: SessionExportOptions,
): SessionExportOptions {
  return options.sizeLimits === undefined
    ? { sizeLimits: DEFAULT_SESSION_EXPORT_SIZE_LIMITS }
    : options;
}

function finishExport(
  content: string,
  mediaType: string,
  kind: SessionExportKind,
  options: SessionExportOptions,
): OperationResult<SerializedSessionExport> {
  const validation = validateLimits(options);
  if (!validation.ok) return validation;
  const byteLength = new TextEncoder().encode(content).byteLength;
  const hardLimit = options.sizeLimits?.hardByteLimit;
  if (hardLimit !== undefined && byteLength > hardLimit) {
    return {
      ok: false,
      error: exportError(
        "EXPORT_HARD_BYTE_LIMIT_EXCEEDED",
        "The generated export exceeds the configured hard byte limit.",
        { kind, byteLength, hardByteLimit: hardLimit },
      ),
      warnings: [],
    };
  }
  const warnings: ParserWarning[] = [];
  const softLimit = options.sizeLimits?.softByteLimit;
  if (softLimit !== undefined && byteLength > softLimit) {
    warnings.push(
      parserWarning(
        "EXPORT_SOFT_BYTE_LIMIT_EXCEEDED",
        "The generated export exceeds the configured warning threshold; the complete export was produced without truncation.",
        { details: { kind, byteLength, softByteLimit: softLimit } },
      ),
    );
  }
  return {
    ok: true,
    value: { content, mediaType, byteLength },
    warnings,
  };
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString(10) : value;
}

export function serializeSessionJson(
  session: Session,
  options: SessionExportOptions = {},
): OperationResult<SerializedSessionExport> {
  const resolvedOptions = resolveExportOptions(options);
  const document: SessionJsonDocument = {
    format: SESSION_JSON_FORMAT,
    version: SESSION_JSON_VERSION,
    session,
  };
  const content = `${JSON.stringify(document, jsonReplacer, 2)}\n`;
  return finishExport(
    content,
    "application/json;charset=utf-8",
    "json",
    resolvedOptions,
  );
}

function csvString(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function syntheticLine(
  timestamp: string,
  eventType: string,
  fields: readonly string[],
): string {
  return `${timestamp}  ${eventType},${fields.join(",")}`;
}

function transposeTargetIdentity(raw: string, session: Session): string {
  return session.targets.reduce((transposed, target) => {
    const withGuid = transposed.replaceAll(
      target.guid,
      WOWCOACH_REFERENCE_BOSS_GUID,
    );
    return target.name === undefined
      ? withGuid
      : withGuid.replaceAll(
          csvString(target.name),
          csvString(WOWCOACH_REFERENCE_ENCOUNTER.name),
        );
  }, raw);
}

function transposeNeutralBossFlags(raw: string): string {
  const identity = `${WOWCOACH_REFERENCE_BOSS_GUID},${csvString(
    WOWCOACH_REFERENCE_ENCOUNTER.name,
  )},`;
  return raw
    .replaceAll(`${identity}0xa28,`, `${identity}0xa48,`)
    .replaceAll(`${identity}0x10a28,`, `${identity}0x10a48,`);
}

const SPELL_ADVANCED_MAP_EVENT_TYPES = new Set([
  "SPELL_CAST_SUCCESS",
  "SPELL_DAMAGE",
  "SPELL_PERIODIC_DAMAGE",
  "RANGE_DAMAGE",
  "SPELL_HEAL",
  "SPELL_PERIODIC_HEAL",
  "SPELL_ENERGIZE",
  "SPELL_PERIODIC_ENERGIZE",
  "SPELL_DRAIN",
]);

const NON_SPELL_ADVANCED_MAP_EVENT_TYPES = new Set([
  "SWING_DAMAGE",
  "SWING_DAMAGE_LANDED",
  "ENVIRONMENTAL_DAMAGE",
]);

function rewriteAdvancedMapId(event: Session["events"][number]): string {
  const fieldIndex = SPELL_ADVANCED_MAP_EVENT_TYPES.has(event.type)
    ? 28
    : NON_SPELL_ADVANCED_MAP_EVENT_TYPES.has(event.type)
      ? 25
      : undefined;
  if (
    fieldIndex === undefined ||
    event.rawFields[fieldIndex]?.value !== "2393"
  ) {
    return event.raw;
  }
  const separator = event.raw.indexOf("  ");
  if (separator < 0) return event.raw;
  const fields = event.rawFields.map((field, index) =>
    index === fieldIndex ? WOWCOACH_REFERENCE_ENCOUNTER.uiMapId : field.raw,
  );
  return `${event.raw.slice(0, separator + 2)}${fields.join(",")}`;
}

const ENVELOPE_EVENT_TYPES = new Set([
  "COMBAT_LOG_VERSION",
  "COMBATANT_INFO",
  "ENCOUNTER_START",
  "ENCOUNTER_END",
  "ZONE_CHANGE",
  "MAP_CHANGE",
]);

export function serializeEncounterSessionLog(
  session: Session,
  options: SessionExportOptions = {},
): OperationResult<SerializedSessionExport> {
  const resolvedOptions = resolveExportOptions(options);
  const version = session.events.find(
    (event) => event.type === "COMBAT_LOG_VERSION",
  );
  const metadataTimestamp = version?.timestamp.raw ?? session.startTime.raw;
  const durationMs = ((session.durationTicks + 5n) / 10n).toString(10);
  // WowCoach rejects this compatibility form when either context record is
  // omitted, even when the encounter and character payloads are unchanged.
  const lines = [
    ...(version === undefined ? [] : [version.raw]),
    syntheticLine(metadataTimestamp, "ZONE_CHANGE", [
      WOWCOACH_REFERENCE_ENCOUNTER.instanceId,
      csvString(WOWCOACH_REFERENCE_ENCOUNTER.zoneName),
      WOWCOACH_REFERENCE_ENCOUNTER.difficultyId,
    ]),
    syntheticLine(metadataTimestamp, "MAP_CHANGE", [
      WOWCOACH_REFERENCE_ENCOUNTER.uiMapId,
      csvString(WOWCOACH_REFERENCE_ENCOUNTER.zoneName),
      ...WOWCOACH_REFERENCE_ENCOUNTER.mapBounds,
    ]),
    syntheticLine(session.startTime.raw, "ENCOUNTER_START", [
      WOWCOACH_REFERENCE_ENCOUNTER.id,
      csvString(WOWCOACH_REFERENCE_ENCOUNTER.name),
      WOWCOACH_REFERENCE_ENCOUNTER.difficultyId,
      WOWCOACH_REFERENCE_ENCOUNTER.groupSize,
      WOWCOACH_REFERENCE_ENCOUNTER.instanceId,
    ]),
    `${session.startTime.raw}  ${WOWCOACH_REFERENCE_COMBATANT_INFO}`,
    ...session.events
      .filter(
        (event) =>
          !ENVELOPE_EVENT_TYPES.has(event.type) &&
          event.timestamp.localTimeTicks >= session.startTime.localTimeTicks &&
          event.timestamp.localTimeTicks <= session.endTime.localTimeTicks,
      )
      .map((event) =>
        transposeNeutralBossFlags(
          transposeTargetIdentity(rewriteAdvancedMapId(event), session),
        ),
      ),
    syntheticLine(session.endTime.raw, "ENCOUNTER_END", [
      WOWCOACH_REFERENCE_ENCOUNTER.id,
      csvString(WOWCOACH_REFERENCE_ENCOUNTER.name),
      WOWCOACH_REFERENCE_ENCOUNTER.difficultyId,
      WOWCOACH_REFERENCE_ENCOUNTER.groupSize,
      "0",
      durationMs,
    ]),
  ];
  const exported = finishExport(
    `${lines.join("\n")}\n`,
    "text/plain;charset=utf-8",
    "encounter-log",
    resolvedOptions,
  );
  if (!exported.ok) return exported;
  return {
    ...exported,
    warnings: [
      parserWarning(
        "WOWCOACH_COMPATIBILITY_TEMPLATE_USED",
        "This WowCoach-compatible export uses the verified Blackwing Lair/Razorgore template and fixed COMBATANT_INFO from data/boss-encounter.txt. Selected dummy identity, neutral NPC flags, and advanced map IDs are transposed, and the encounter ends as a wipe.",
        {
          details: {
            selectedPlayerGuid: session.player.guid,
            referencePlayerGuid: WOWCOACH_REFERENCE_COMBATANT_GUID,
            referenceEncounterId: Number(WOWCOACH_REFERENCE_ENCOUNTER.id),
          },
        },
      ),
      ...exported.warnings,
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isTimestampShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value["raw"]) &&
    isString(value["fractionalComponent"]) &&
    isString(value["localTimeTicks"]) &&
    TICK_PATTERN.test(value["localTimeTicks"])
  );
}

function isActorShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value["guid"]) &&
    isString(value["type"]) &&
    isString(value["relationship"])
  );
}

function isEventShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isTimestampShape(value["timestamp"]) &&
    isString(value["relativeTimeTicks"]) &&
    TICK_PATTERN.test(value["relativeTimeTicks"]) &&
    isString(value["type"]) &&
    isString(value["family"]) &&
    typeof value["normalized"] === "boolean" &&
    Array.isArray(value["rawFields"]) &&
    Array.isArray(value["additionalFields"]) &&
    isString(value["origin"]) &&
    isString(value["parserVersion"]) &&
    isString(value["schemaId"]) &&
    isString(value["raw"]) &&
    isString(value["lineTerminator"]) &&
    isRecord(value["location"]) &&
    isRecord(value["payload"])
  );
}

function isSessionDocument(
  value: unknown,
): value is { readonly session: Record<string, unknown> } {
  if (
    !isRecord(value) ||
    value["format"] !== SESSION_JSON_FORMAT ||
    value["version"] !== SESSION_JSON_VERSION ||
    !isRecord(value["session"])
  ) {
    return false;
  }
  const session = value["session"];
  return (
    isString(session["id"]) &&
    isRecord(session["parser"]) &&
    isTimestampShape(session["startTime"]) &&
    isTimestampShape(session["endTime"]) &&
    isString(session["durationTicks"]) &&
    TICK_PATTERN.test(session["durationTicks"]) &&
    isActorShape(session["player"]) &&
    Array.isArray(session["targets"]) &&
    session["targets"].length > 0 &&
    session["targets"].every(isActorShape) &&
    Array.isArray(session["actors"]) &&
    session["actors"].every(isActorShape) &&
    Array.isArray(session["events"]) &&
    session["events"].every(isEventShape) &&
    Array.isArray(session["warnings"]) &&
    isRecord(session["statistics"])
  );
}

function restoreTickValues(value: unknown, key?: string): unknown {
  if (key !== undefined && TICK_KEYS.has(key)) {
    if (!isString(value) || !TICK_PATTERN.test(value)) {
      throw new Error(`Invalid bigint tick value for '${key}'.`);
    }
    return BigInt(value);
  }
  if (Array.isArray(value)) return value.map((item) => restoreTickValues(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        restoreTickValues(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

export function parseSessionJson(text: string): OperationResult<Session> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        category: "invalid-combat-log",
        code: "INVALID_SESSION_JSON",
        message: "The selected JSON is not a valid session export.",
        recoverable: true,
        suggestedAction: "Choose an unmodified session.json export.",
        technicalDetails: {
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
      warnings: [],
    };
  }
  if (!isSessionDocument(parsed)) {
    return {
      ok: false,
      error: {
        category: "invalid-combat-log",
        code: "UNSUPPORTED_SESSION_JSON",
        message:
          "The JSON does not match the supported versioned session format.",
        recoverable: true,
        suggestedAction: "Choose a version 1 session.json export.",
      },
      warnings: [],
    };
  }
  try {
    const restored = restoreTickValues(parsed.session);
    return {
      ok: true,
      value: restored as Session,
      warnings: [],
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        category: "invalid-combat-log",
        code: "INVALID_SESSION_TICK_ENCODING",
        message: "The session JSON contains an invalid exact tick value.",
        recoverable: true,
        suggestedAction: "Choose an unmodified session.json export.",
        technicalDetails: {
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
      warnings: [],
    };
  }
}

function safeFilenamePart(value: string): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/gu, "");
  return safe.length === 0 ? "session" : safe;
}

function compactTimestamp(raw: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/u.exec(
    raw,
  );
  if (match === null) return "unknown-time";
  const [, month, day, year, hour, minute, second] = match;
  if (
    month === undefined ||
    day === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return "unknown-time";
  }
  return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}-${hour}${minute}${second}`;
}

export function sessionExportFilename(
  session: Session,
  kind: SessionExportKind,
): string {
  const actor = safeFilenamePart(session.player.name ?? session.player.guid);
  const time = compactTimestamp(session.startTime.raw);
  return kind === "json"
    ? `${actor}-${time}.session.json`
    : `${actor}-${time}.session.encounter.log`;
}
