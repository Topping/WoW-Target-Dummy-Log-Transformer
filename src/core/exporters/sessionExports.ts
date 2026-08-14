import type {
  AppError,
  OperationResult,
  ParserWarning,
  SerializedSessionExport,
  Session,
  SessionExportKind,
  SessionExportOptions,
} from "../contracts";
import { parserWarning } from "../parser/diagnostics";

export const SESSION_JSON_FORMAT = "wow-training-dummy-session";
export const SESSION_JSON_VERSION = 1;

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
    options,
  );
}

export function serializeFilteredSessionLog(
  session: Session,
  options: SessionExportOptions = {},
): OperationResult<SerializedSessionExport> {
  const content = session.events
    .map((event) => event.raw + event.lineTerminator)
    .join("");
  return finishExport(
    content,
    "text/plain;charset=utf-8",
    "filtered-log",
    options,
  );
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
    : `${actor}-${time}.session.filtered.log`;
}
