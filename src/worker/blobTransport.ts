import type { AppError, OperationResult } from "../core";
import {
  IncrementalLineDecoder,
  defaultSchemaRegistry,
  parseCombatLogVersion,
  parseRawRecord,
} from "../core";

export const INITIAL_SAMPLE_BYTES = 64 * 1024;

function validationError<T>(
  category: AppError["category"],
  code: string,
  message: string,
  suggestedAction: string,
): OperationResult<T> {
  return {
    ok: false,
    error: { category, code, message, recoverable: true, suggestedAction },
    warnings: [],
  };
}

export async function validateCombatLogBlob(
  blob: Blob,
): Promise<OperationResult<number>> {
  if (blob.size === 0) {
    return validationError<number>(
      "empty-file",
      "EMPTY_FILE",
      "The selected file is empty.",
      "Choose a non-empty WoWCombatLog.txt file.",
    );
  }
  const sampleSize = Math.min(blob.size, INITIAL_SAMPLE_BYTES);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await blob.slice(0, sampleSize).arrayBuffer());
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        category: "file-unreadable",
        code: "FILE_SAMPLE_UNREADABLE",
        message: "The selected file could not be read.",
        recoverable: true,
        suggestedAction: "Choose the file again or make a new copy of it.",
        technicalDetails: {
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
      warnings: [],
    };
  }

  const decoder = new IncrementalLineDecoder();
  const decoded = decoder.push(bytes);
  if (!decoded.ok) return decoded;
  let completeLines = decoded.value.filter((line) => line.raw.length > 0);
  if (sampleSize === blob.size) {
    const final = decoder.finish();
    if (!final.ok) return final;
    completeLines = [...completeLines, ...final.value].filter(
      (line) => line.raw.length > 0,
    );
  }
  if (completeLines.length === 0) {
    return validationError<number>(
      "invalid-combat-log",
      "NO_COMPLETE_SAMPLE_RECORD",
      "The selected file does not begin with a complete WoW combat-log record.",
      "Choose the original WoWCombatLog.txt file.",
    );
  }

  let recognizedRecordCount = 0;
  let versionFound = false;
  for (const line of completeLines) {
    const parsed = parseRawRecord(line.raw, line.location);
    if (!parsed.ok) {
      return {
        ok: false,
        error: {
          ...parsed.error,
          category: "invalid-combat-log",
          code: "INVALID_INITIAL_SAMPLE",
          message:
            "The selected file does not begin with valid WoW combat-log records.",
          suggestedAction: "Choose the original WoWCombatLog.txt file.",
        },
        warnings: parsed.warnings,
      };
    }
    recognizedRecordCount += 1;
    if (parsed.value.eventType === "COMBAT_LOG_VERSION") {
      const version = parseCombatLogVersion(parsed.value);
      if (!version.ok) return version;
      const schema = defaultSchemaRegistry.select(version.value);
      if (!schema.ok) return schema;
      versionFound = true;
    }
  }
  if (recognizedRecordCount === 0 || !versionFound) {
    return validationError<number>(
      "invalid-combat-log",
      "UNRELATED_FILE_CONTENT",
      "The selected file does not look like a complete WoW combat log.",
      "Choose WoWCombatLog.txt from the game's Logs folder.",
    );
  }
  return { ok: true, value: sampleSize, warnings: [] };
}

export async function* streamBlobBytes(
  blob: Blob,
  shouldAbort: () => boolean,
): AsyncGenerator<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    while (!shouldAbort()) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    if (shouldAbort()) await reader.cancel("Operation cancelled");
    reader.releaseLock();
  }
}
