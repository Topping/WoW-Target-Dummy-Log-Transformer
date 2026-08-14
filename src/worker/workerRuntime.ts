import type {
  AppError,
  OperationResult,
  ProcessingPhase,
  Session,
  SessionDiscoveryOptions,
  SessionExtractionOptions,
  SessionSelection,
} from "../core";
import { discoverCombatLogChunks } from "../core";

import { streamBlobBytes, validateCombatLogBlob } from "./blobTransport";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

interface OperationToken {
  readonly operationId: string;
  aborted: boolean;
}

export interface SessionProcessingContext {
  readonly operationId: string;
  readonly shouldAbort: () => boolean;
  readonly options: SessionExtractionOptions;
  readonly reportProgress: (
    phase: ProcessingPhase,
    bytesProcessed: number,
    status: string,
  ) => void;
}

export type SessionProcessor = (
  file: File,
  selection: SessionSelection,
  context: SessionProcessingContext,
) => Promise<OperationResult<Session>>;

function cancellationError(): AppError {
  return {
    category: "cancelled",
    code: "OPERATION_CANCELLED",
    message: "Processing was cancelled.",
    recoverable: true,
    suggestedAction: "Start a new operation when you are ready.",
  };
}

function unavailableSessionProcessor(): Promise<OperationResult<Session>> {
  return Promise.resolve({
    ok: false,
    error: {
      category: "internal",
      code: "SESSION_PROCESSOR_NOT_INSTALLED",
      message:
        "Detailed session processing is not available in this build yet.",
      recoverable: true,
      suggestedAction: "Return to session selection.",
    },
    warnings: [],
  });
}

export class ParserWorkerRuntime {
  readonly #postResponse: (response: WorkerResponse) => void;
  readonly #processSession: SessionProcessor;
  #active: OperationToken | undefined;

  constructor(
    postResponse: (response: WorkerResponse) => void,
    processSession: SessionProcessor = unavailableSessionProcessor,
  ) {
    this.#postResponse = postResponse;
    this.#processSession = processSession;
  }

  handle(request: WorkerRequest): void {
    if (request.type === "CANCEL") {
      this.#cancel(request.operationId);
      return;
    }
    const token = this.#begin(request.operationId);
    if (request.type === "DISCOVER_FILE") {
      void this.#discover(request.file, request.options, token).catch(
        (error: unknown) => {
          this.#unexpectedFailure(token, error);
        },
      );
    } else {
      void this.#process(
        request.file,
        request.selection,
        request.options,
        token,
      ).catch((error: unknown) => {
        this.#unexpectedFailure(token, error);
      });
    }
  }

  #begin(operationId: string): OperationToken {
    if (this.#active !== undefined) this.#active.aborted = true;
    const token = { operationId, aborted: false };
    this.#active = token;
    return token;
  }

  #isCurrent(token: OperationToken): boolean {
    return this.#active === token && !token.aborted;
  }

  #cancel(operationId: string): void {
    const token = this.#active;
    if (token?.operationId !== operationId) return;
    token.aborted = true;
    this.#active = undefined;
    this.#postResponse({
      type: "ERROR",
      operationId,
      error: cancellationError(),
    });
  }

  #finish(token: OperationToken): void {
    if (this.#active === token) this.#active = undefined;
  }

  #unexpectedFailure(token: OperationToken, error: unknown): void {
    if (!this.#isCurrent(token)) return;
    this.#postResponse({
      type: "ERROR",
      operationId: token.operationId,
      error: {
        category: "internal",
        code: "WORKER_OPERATION_FAILED",
        message: "The worker could not finish this operation.",
        recoverable: true,
        suggestedAction: "Try the operation again.",
        technicalDetails: {
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      },
    });
    this.#finish(token);
  }

  #progress(
    token: OperationToken,
    phase: ProcessingPhase,
    bytesProcessed: number,
    totalBytes: number,
    status: string,
  ): void {
    if (!this.#isCurrent(token)) return;
    this.#postResponse({
      type: "PROGRESS",
      progress: {
        operationId: token.operationId,
        phase,
        bytesProcessed: Math.min(bytesProcessed, totalBytes),
        totalBytes,
        status,
      },
    });
  }

  async #discover(
    file: File,
    options: SessionDiscoveryOptions | undefined,
    token: OperationToken,
  ): Promise<void> {
    const total = file.size;
    this.#progress(token, "opening-file", 0, total, "Opening file");
    this.#progress(
      token,
      "validating-file",
      0,
      total,
      "Validating file contents",
    );
    const validation = await validateCombatLogBlob(file);
    if (!this.#isCurrent(token)) return;
    if (!validation.ok) {
      this.#postResponse({
        type: "ERROR",
        operationId: token.operationId,
        error: validation.error,
      });
      this.#finish(token);
      return;
    }
    this.#progress(
      token,
      "validating-file",
      validation.value,
      total,
      "File contents validated",
    );
    this.#progress(
      token,
      "scanning-actors",
      0,
      total,
      "Scanning actors and activity",
    );
    let scannedBytes = 0;
    const result = await discoverCombatLogChunks(
      streamBlobBytes(file, () => !this.#isCurrent(token)),
      {
        name: file.name,
        sizeBytes: file.size,
        lastModifiedMs: file.lastModified,
      },
      {
        ...(options ?? {}),
        shouldAbort: () => !this.#isCurrent(token),
        onBytesProcessed: (bytesProcessed) => {
          scannedBytes = bytesProcessed;
          this.#progress(
            token,
            "scanning-actors",
            bytesProcessed,
            total,
            "Scanning actors and activity",
          );
        },
      },
    );
    if (!this.#isCurrent(token)) return;
    if (scannedBytes !== total) {
      this.#postResponse({
        type: "ERROR",
        operationId: token.operationId,
        error: {
          category: "file-unreadable",
          code: "INCOMPLETE_BLOB_READ",
          message:
            "The selected file changed or ended before it was fully read.",
          recoverable: true,
          suggestedAction: "Choose the file again or make a new copy of it.",
          technicalDetails: {
            details: { expectedBytes: total, processedBytes: scannedBytes },
          },
        },
      });
      this.#finish(token);
      return;
    }
    if (!result.ok) {
      this.#postResponse({
        type: "ERROR",
        operationId: token.operationId,
        error: result.error,
      });
      this.#finish(token);
      return;
    }
    this.#progress(
      token,
      "detecting-attempts",
      scannedBytes,
      total,
      "Ranking training attempts",
    );
    if (!this.#isCurrent(token)) return;
    this.#postResponse({
      type: "DISCOVERY_COMPLETE",
      operationId: token.operationId,
      result: result.value,
      warnings: result.warnings,
    });
    this.#finish(token);
  }

  async #process(
    file: File,
    selection: SessionSelection,
    options: SessionExtractionOptions | undefined,
    token: OperationToken,
  ): Promise<void> {
    this.#progress(
      token,
      "processing-session",
      0,
      file.size,
      "Processing selected session",
    );
    const result = await this.#processSession(file, selection, {
      operationId: token.operationId,
      shouldAbort: () => !this.#isCurrent(token),
      options: options ?? {},
      reportProgress: (phase, bytesProcessed, status) => {
        this.#progress(token, phase, bytesProcessed, file.size, status);
      },
    });
    if (!this.#isCurrent(token)) return;
    if (!result.ok) {
      this.#postResponse({
        type: "ERROR",
        operationId: token.operationId,
        error: result.error,
      });
      this.#finish(token);
      return;
    }
    this.#postResponse({
      type: "SESSION_COMPLETE",
      operationId: token.operationId,
      session: result.value,
    });
    this.#finish(token);
  }
}
