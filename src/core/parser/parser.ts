import type {
  CombatLogOrigin,
  CombatLogVersion,
  OperationResult,
  ParsedCombatLog,
  ParserMetadata,
  ParserWarning,
  RawCombatLogRecord,
} from "../contracts";

import { parserWarning } from "./diagnostics";
import { IncrementalLineDecoder, type DecodedLine } from "./lineReader";
import { parseRawRecord } from "./rawRecord";
import {
  defaultSchemaRegistry,
  parseCombatLogVersion,
  type CombatLogSchemaRegistry,
} from "./schema";

export const PARSER_VERSION = "0.2.0";

export interface ParseCombatLogOptions {
  readonly registry?: CombatLogSchemaRegistry;
  readonly sourceVersion?: CombatLogVersion;
  readonly manualSchemaId?: string;
  readonly origin?: CombatLogOrigin;
}

function emptyInputFailure(): OperationResult<ParsedCombatLog> {
  return {
    ok: false,
    error: {
      category: "empty-file",
      code: "NO_COMBAT_LOG_RECORDS",
      message: "No WoW combat-log records were found.",
      recoverable: true,
      suggestedAction: "Choose a non-empty WoWCombatLog.txt file.",
    },
    warnings: [],
  };
}

function readDecodedLine(
  line: DecodedLine,
  records: RawCombatLogRecord[],
  warnings: ParserWarning[],
): OperationResult<undefined> {
  if (line.raw.length === 0) {
    warnings.push(
      parserWarning("EMPTY_SOURCE_LINE", "An empty source line was ignored.", {
        location: line.location,
        rawLine: line.raw,
      }),
    );
    return { ok: true, value: undefined, warnings: [] };
  }
  const parsed = parseRawRecord(line.raw, line.location);
  if (!parsed.ok) return parsed;
  records.push(parsed.value);
  warnings.push(...parsed.warnings);
  return { ok: true, value: undefined, warnings: [] };
}

export async function parseCombatLogChunks(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: ParseCombatLogOptions = {},
): Promise<OperationResult<ParsedCombatLog>> {
  const decoder = new IncrementalLineDecoder();
  const rawRecords: RawCombatLogRecord[] = [];
  const warnings: ParserWarning[] = [];
  let linesRead = 0;

  try {
    for await (const chunk of chunks) {
      const decoded = decoder.push(chunk);
      if (!decoded.ok)
        return { ...decoded, warnings: [...warnings, ...decoded.warnings] };
      for (const line of decoded.value) {
        linesRead += 1;
        const result = readDecodedLine(line, rawRecords, warnings);
        if (!result.ok)
          return { ...result, warnings: [...warnings, ...result.warnings] };
      }
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        category: "file-unreadable",
        code: "BYTE_STREAM_FAILED",
        message: "The combat-log byte stream could not be read.",
        recoverable: true,
        suggestedAction: "Try choosing the source file again.",
        technicalDetails: {
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
      warnings,
    };
  }

  const finalLines = decoder.finish();
  if (!finalLines.ok)
    return { ...finalLines, warnings: [...warnings, ...finalLines.warnings] };
  for (const line of finalLines.value) {
    linesRead += 1;
    const result = readDecodedLine(line, rawRecords, warnings);
    if (!result.ok)
      return { ...result, warnings: [...warnings, ...result.warnings] };
  }

  if (rawRecords.length === 0) {
    const empty = emptyInputFailure();
    return { ...empty, warnings };
  }

  let detectedVersion = options.sourceVersion;
  if (detectedVersion === undefined) {
    const versionRecord = rawRecords.find(
      (record) => record.eventType === "COMBAT_LOG_VERSION",
    );
    if (versionRecord === undefined) {
      return {
        ok: false,
        error: {
          category: "invalid-combat-log",
          code: "MISSING_LOG_VERSION",
          message: "The input does not contain a combat-log version record.",
          recoverable: true,
          suggestedAction:
            "Choose the complete WoWCombatLog.txt file rather than an unlabelled excerpt.",
        },
        warnings,
      };
    }
    const parsedVersion = parseCombatLogVersion(versionRecord);
    if (!parsedVersion.ok)
      return {
        ...parsedVersion,
        warnings: [...warnings, ...parsedVersion.warnings],
      };
    detectedVersion = parsedVersion.value;
  }

  const registry = options.registry ?? defaultSchemaRegistry;
  const selected = registry.select(detectedVersion, {
    ...(options.manualSchemaId === undefined
      ? {}
      : { manualSchemaId: options.manualSchemaId }),
  });
  if (!selected.ok)
    return { ...selected, warnings: [...warnings, ...selected.warnings] };
  warnings.push(...selected.warnings);

  const parser: ParserMetadata = {
    parserVersion: PARSER_VERSION,
    schema: {
      id: selected.value.schema.id,
      selection: selected.value.selection,
      detectedVersion,
    },
  };
  const firstTimestampTicks = rawRecords[0]?.timestamp.localTimeTicks;
  if (firstTimestampTicks === undefined) return emptyInputFailure();

  const records = [];
  for (const rawRecord of rawRecords) {
    const normalized = selected.value.schema.normalize(rawRecord, {
      parserVersion: PARSER_VERSION,
      firstTimestampTicks,
      origin: options.origin ?? "combat-log",
    });
    if (!normalized.ok)
      return { ...normalized, warnings: [...warnings, ...normalized.warnings] };
    records.push(normalized.value);
    warnings.push(...normalized.warnings);
  }

  return {
    ok: true,
    value: { parser, records, linesRead },
    warnings,
  };
}

export function parseCombatLogText(
  text: string,
  options: ParseCombatLogOptions = {},
): Promise<OperationResult<ParsedCombatLog>> {
  return parseCombatLogChunks([new TextEncoder().encode(text)], options);
}
