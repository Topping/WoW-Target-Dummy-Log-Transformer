import type { OperationResult, RawField, SourceLocation } from "../contracts";

import { parserFailure } from "./diagnostics";

export function tokenizeCsv(
  input: string,
  location?: SourceLocation,
  rawLine?: string,
): OperationResult<readonly RawField[]> {
  const fields: RawField[] = [];
  let index = 0;

  while (index <= input.length) {
    const start = index;
    if (input[index] === '"') {
      index += 1;
      let value = "";
      let closed = false;
      while (index < input.length) {
        const character = input[index];
        if (character === undefined) break;
        if (character === '"') {
          if (input[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += character;
        index += 1;
      }

      if (!closed || (index < input.length && input[index] !== ",")) {
        return {
          ok: false,
          error: parserFailure(
            "MALFORMED_CSV_QUOTE",
            "This record contains an unterminated or misplaced quoted field.",
            location,
            rawLine,
            { fieldStart: start },
          ),
          warnings: [],
        };
      }

      fields.push({ raw: input.slice(start, index), value, quoted: true });
    } else {
      while (index < input.length && input[index] !== ",") index += 1;
      const raw = input.slice(start, index);
      if (raw.includes('"')) {
        return {
          ok: false,
          error: parserFailure(
            "MALFORMED_CSV_QUOTE",
            "This record contains a quote in an unquoted field.",
            location,
            rawLine,
            { fieldStart: start },
          ),
          warnings: [],
        };
      }
      fields.push({ raw, value: raw, quoted: false });
    }

    if (index === input.length) break;
    index += 1;
    if (index === input.length) {
      fields.push({ raw: "", value: "", quoted: false });
      break;
    }
  }

  return { ok: true, value: fields, warnings: [] };
}

export function serializeCsv(fields: readonly RawField[]): string {
  return fields.map((field) => field.raw).join(",");
}
