import type {
  OperationResult,
  RawCombatLogRecord,
  SourceLocation,
} from "../contracts";

import { tokenizeCsv } from "./csv";
import { parserFailure } from "./diagnostics";
import { parseTimestamp } from "./timestamp";

const RECORD_PATTERN = /^(\S+ \S+) {2}(.+)$/;

export function parseRawRecord(
  rawLine: string,
  location: SourceLocation,
): OperationResult<RawCombatLogRecord> {
  const match = RECORD_PATTERN.exec(rawLine);
  if (match?.[1] === undefined || match[2] === undefined) {
    return {
      ok: false,
      error: parserFailure(
        "MALFORMED_RECORD",
        "This line does not have a combat-log timestamp and payload.",
        location,
        rawLine,
      ),
      warnings: [],
    };
  }

  const timestamp = parseTimestamp(match[1], location, rawLine);
  if (!timestamp.ok) return timestamp;
  const fields = tokenizeCsv(match[2], location, rawLine);
  if (!fields.ok) return fields;
  const eventType = fields.value[0]?.value;
  if (eventType === undefined || eventType.length === 0) {
    return {
      ok: false,
      error: parserFailure(
        "MISSING_EVENT_TYPE",
        "This record does not identify an event type.",
        location,
        rawLine,
      ),
      warnings: [],
    };
  }

  return {
    ok: true,
    value: {
      timestamp: timestamp.value,
      eventType,
      fields: fields.value,
      raw: rawLine,
      location,
    },
    warnings: [],
  };
}
