import type { CombatEvent, RawCombatLogRecord } from "../contracts";

import { serializeCsv } from "./csv";

export function serializeRawRecord(record: RawCombatLogRecord): string {
  return `${record.timestamp.raw}  ${serializeCsv(record.fields)}`;
}

/** Supported and generic records retain their exact source representation. */
export function serializeCombatEvent(event: CombatEvent): string {
  return event.raw;
}
