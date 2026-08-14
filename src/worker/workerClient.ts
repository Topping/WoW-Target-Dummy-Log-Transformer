import type {
  AppError,
  DiscoveryResult,
  OperationResult,
  ParserWarning,
  ProcessingProgress,
  Session,
  SessionDiscoveryOptions,
  SessionExtractionOptions,
  SessionSelection,
} from "../core";

import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

export interface WorkerTransport {
  postMessage(message: WorkerRequest): void;
  addEventListener(
    type: "message",
    listener: (event: WorkerMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: WorkerMessageEvent) => void,
  ): void;
  terminate(): void;
}

export interface WorkerMessageEvent {
  readonly data: WorkerResponse;
}

export interface WorkerOperationOptions {
  readonly onProgress?: (progress: ProcessingProgress) => void;
}

export interface DiscoverWorkerOperationOptions extends WorkerOperationOptions {
  readonly discoveryOptions?: SessionDiscoveryOptions;
}

export interface ProcessWorkerOperationOptions extends WorkerOperationOptions {
  readonly extractionOptions?: SessionExtractionOptions;
}

interface PendingOperation<T> {
  readonly operationId: string;
  readonly onProgress?: (progress: ProcessingProgress) => void;
  readonly resolve: (result: OperationResult<T>) => void;
}

function cancelledResult<T>(): OperationResult<T> {
  return {
    ok: false,
    error: {
      category: "cancelled",
      code: "OPERATION_CANCELLED",
      message: "Processing was cancelled.",
      recoverable: true,
      suggestedAction: "Start a new operation when you are ready.",
    },
    warnings: [],
  };
}

export class ParserWorkerClient {
  readonly #worker: WorkerTransport;
  readonly #handleMessage: (event: WorkerMessageEvent) => void;
  #pendingDiscovery: PendingOperation<DiscoveryResult> | undefined;
  #pendingSession: PendingOperation<Session> | undefined;
  #nextOperationNumber = 1;

  constructor(worker: WorkerTransport) {
    this.#worker = worker;
    this.#handleMessage = (event) => {
      this.#receive(event.data);
    };
    this.#worker.addEventListener("message", this.#handleMessage);
  }

  discover(
    file: File,
    options: DiscoverWorkerOperationOptions = {},
  ): Promise<OperationResult<DiscoveryResult>> {
    this.cancel();
    const operationId = this.#operationId();
    return new Promise((resolve) => {
      this.#pendingDiscovery = {
        operationId,
        ...(options.onProgress === undefined
          ? {}
          : { onProgress: options.onProgress }),
        resolve,
      };
      this.#worker.postMessage({
        type: "DISCOVER_FILE",
        operationId,
        file,
        ...(options.discoveryOptions === undefined
          ? {}
          : { options: options.discoveryOptions }),
      });
    });
  }

  process(
    file: File,
    selection: SessionSelection,
    options: ProcessWorkerOperationOptions = {},
  ): Promise<OperationResult<Session>> {
    this.cancel();
    const operationId = this.#operationId();
    return new Promise((resolve) => {
      this.#pendingSession = {
        operationId,
        ...(options.onProgress === undefined
          ? {}
          : { onProgress: options.onProgress }),
        resolve,
      };
      this.#worker.postMessage({
        type: "PROCESS_SESSION",
        operationId,
        file,
        selection,
        ...(options.extractionOptions === undefined
          ? {}
          : { options: options.extractionOptions }),
      });
    });
  }

  cancel(): void {
    const pending = this.#currentPending();
    if (pending === undefined) return;
    this.#worker.postMessage({
      type: "CANCEL",
      operationId: pending.operationId,
    });
    pending.resolve(cancelledResult());
    this.#pendingDiscovery = undefined;
    this.#pendingSession = undefined;
  }

  dispose(): void {
    this.cancel();
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.terminate();
  }

  #operationId(): string {
    const id = `worker-operation-${String(this.#nextOperationNumber)}`;
    this.#nextOperationNumber += 1;
    return id;
  }

  #currentPending():
    PendingOperation<DiscoveryResult> | PendingOperation<Session> | undefined {
    return this.#pendingDiscovery ?? this.#pendingSession;
  }

  #receive(response: WorkerResponse): void {
    const pending = this.#currentPending();
    const operationId =
      response.type === "PROGRESS"
        ? response.progress.operationId
        : response.operationId;
    if (pending?.operationId !== operationId) return;
    if (response.type === "PROGRESS") {
      pending.onProgress?.(response.progress);
      return;
    }
    if (response.type === "ERROR") {
      this.#resolveError(response.error);
      return;
    }
    if (response.type === "DISCOVERY_COMPLETE") {
      const discovery = this.#pendingDiscovery;
      if (discovery === undefined) return;
      this.#pendingDiscovery = undefined;
      discovery.resolve({
        ok: true,
        value: response.result,
        warnings: response.warnings,
      });
      return;
    }
    const session = this.#pendingSession;
    if (session === undefined) return;
    this.#pendingSession = undefined;
    session.resolve({ ok: true, value: response.session, warnings: [] });
  }

  #resolveError(error: AppError): void {
    const pending = this.#currentPending();
    if (pending === undefined) return;
    this.#pendingDiscovery = undefined;
    this.#pendingSession = undefined;
    const warnings: readonly ParserWarning[] = [];
    pending.resolve({ ok: false, error, warnings });
  }
}

export function createParserWorkerClient(): ParserWorkerClient {
  type BrowserWorkerConstructor = new (
    url: URL,
    options: { readonly type: "module" },
  ) => WorkerTransport;
  const WorkerConstructor = (
    globalThis as unknown as { readonly Worker: BrowserWorkerConstructor }
  ).Worker;
  return new ParserWorkerClient(
    new WorkerConstructor(new URL("./parser.worker.ts", import.meta.url), {
      type: "module",
    }),
  );
}
