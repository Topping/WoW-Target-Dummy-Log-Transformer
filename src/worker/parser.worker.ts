/// <reference lib="webworker" />

import { ParserWorkerRuntime } from "./workerRuntime";
import type { WorkerRequest } from "./workerProtocol";

declare const self: DedicatedWorkerGlobalScope;

const runtime = new ParserWorkerRuntime((response) => {
  self.postMessage(response);
});

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  runtime.handle(event.data);
});
