import {
  extractSessionChunks,
  type OperationResult,
  type Session,
} from "../core";

import { streamBlobBytes } from "./blobTransport";
import type { SessionProcessor } from "./workerRuntime";

export const processSessionFile: SessionProcessor = async (
  file,
  selection,
  context,
): Promise<OperationResult<Session>> =>
  extractSessionChunks(
    streamBlobBytes(file, context.shouldAbort),
    {
      name: file.name,
      sizeBytes: file.size,
      lastModifiedMs: file.lastModified,
    },
    selection,
    {
      ...context.options,
      shouldAbort: context.shouldAbort,
      onBytesProcessed: (bytesProcessed) => {
        context.reportProgress(
          "processing-session",
          bytesProcessed,
          "Reading selected session window",
        );
      },
      onPhase: (phase, bytesProcessed) => {
        context.reportProgress(
          phase,
          bytesProcessed,
          phase === "filtering-events"
            ? "Resolving ownership and filtering events"
            : "Building session result",
        );
      },
    },
  );
