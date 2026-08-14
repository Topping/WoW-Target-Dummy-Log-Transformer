import { File } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  parseTimestamp,
  type DiscoveryResult,
  type OperationResult,
  type Session,
  type SessionSelection,
} from "../src/core";
import {
  ParserWorkerClient,
  ParserWorkerRuntime,
  processSessionFile,
  validateCombatLogBlob,
  type SessionProcessor,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerMessageEvent,
  type WorkerTransport,
} from "../src/worker";

const HEADER =
  "8/14/2026 15:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const DAMAGE =
  '8/14/2026 15:00:01.0000  SPELL_DAMAGE,Player-1,"Recorder",0x511,0x0,Creature-1,"Localized Target",0xa28,0x0,1,"Strike",0x1,100';

function logFile(
  lines: readonly string[] = [HEADER, DAMAGE],
  name = "arbitrary.data",
): File {
  return new File([lines.join("\n")], name, {
    type: "application/octet-stream",
  });
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await delay(1);
  }
  throw new Error(message);
}

function selection(): SessionSelection {
  const start = parseTimestamp("8/14/2026 15:00:01.0000");
  if (!start.ok) throw new Error(start.error.message);
  return {
    id: "session-1",
    playerGuid: "Player-1",
    targetGuids: ["Creature-1"],
    startTime: start.value,
    endTime: start.value,
  };
}

class UnreadableBlob extends Blob {
  override arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("simulated read failure"));
  }
}

class UnreadableFile extends File {
  override slice(): Blob {
    return new UnreadableBlob(["not readable"]);
  }
}

describe("initial browser content validation", () => {
  it("accepts WoW syntax regardless of filename", async () => {
    expect(await validateCombatLogBlob(logFile())).toMatchObject({
      ok: true,
    });
  });

  it("does not reject a valid large sample when its byte limit splits UTF-8", async () => {
    const headerBytes = new TextEncoder().encode(`${HEADER}\n`).byteLength;
    const filler = "x".repeat(64 * 1024 - headerBytes - 1);
    const file = new File([`${HEADER}\n`, filler, "ø\n"], "split-byte.log");
    expect(await validateCombatLogBlob(file)).toMatchObject({ ok: true });
  });

  it.each([
    [new File([], "empty.txt"), "empty-file", "EMPTY_FILE"],
    [
      new File(["ordinary prose"], "WoWCombatLog.txt"),
      "invalid-combat-log",
      "INVALID_INITIAL_SAMPLE",
    ],
    [
      logFile([
        HEADER,
        '8/14/2026 15:00:01.0000  SPELL_DAMAGE,"unterminated',
        "",
      ]),
      "invalid-combat-log",
      "INVALID_INITIAL_SAMPLE",
    ],
    [
      logFile([HEADER.replace("PROJECT_ID,1", "PROJECT_ID,99"), DAMAGE]),
      "unsupported-log-format",
      "NO_COMPATIBLE_SCHEMA",
    ],
    [
      new UnreadableFile(["bytes"], "locked.log"),
      "file-unreadable",
      "FILE_SAMPLE_UNREADABLE",
    ],
  ])("maps invalid input to %s / %s", async (file, category, code) => {
    const result = await validateCombatLogBlob(file);
    expect(result).toMatchObject({
      ok: false,
      error: { category, code, recoverable: true },
    });
  });
});

describe("worker discovery lifecycle", () => {
  it("publishes a typed error rather than completion for an invalid sample", async () => {
    const responses: WorkerResponse[] = [];
    const runtime = new ParserWorkerRuntime((response) =>
      responses.push(response),
    );
    runtime.handle({
      type: "DISCOVER_FILE",
      operationId: "invalid",
      file: new File(["ordinary prose"], "WoWCombatLog.txt"),
    });
    await waitFor(
      () => responses.some((response) => response.type === "ERROR"),
      "invalid sample did not fail",
    );
    expect(responses.at(-1)).toMatchObject({
      type: "ERROR",
      operationId: "invalid",
      error: { category: "invalid-combat-log", recoverable: true },
    });
    expect(
      responses.some((response) => response.type === "DISCOVERY_COMPLETE"),
    ).toBe(false);
  });

  it("streams discovery with truthful monotonic phase progress", async () => {
    const responses: WorkerResponse[] = [];
    const runtime = new ParserWorkerRuntime((response) =>
      responses.push(response),
    );
    const file = logFile();
    runtime.handle({ type: "DISCOVER_FILE", operationId: "discover-1", file });
    await waitFor(
      () =>
        responses.some((response) => response.type === "DISCOVERY_COMPLETE"),
      "discovery did not complete",
    );

    const progress = responses
      .filter((response) => response.type === "PROGRESS")
      .map((response) => response.progress);
    expect(progress.map((item) => item.phase)).toEqual(
      expect.arrayContaining([
        "opening-file",
        "validating-file",
        "scanning-actors",
        "detecting-attempts",
      ]),
    );
    for (const phase of new Set(progress.map((item) => item.phase))) {
      const values = progress
        .filter((item) => item.phase === phase)
        .map((item) => item.bytesProcessed);
      expect(values).toEqual([...values].sort((left, right) => left - right));
      expect(values.every((value) => value <= file.size)).toBe(true);
    }
    const complete = responses.find(
      (response) => response.type === "DISCOVERY_COMPLETE",
    );
    expect(
      complete?.type === "DISCOVERY_COMPLETE" ? complete.result : undefined,
    ).toMatchObject({
      proposedRecorderGuid: "Player-1",
      recordsScanned: 2,
    });
  });

  it("carries configurable discovery options through DISCOVER_FILE", async () => {
    const responses: WorkerResponse[] = [];
    const runtime = new ParserWorkerRuntime((response) =>
      responses.push(response),
    );
    runtime.handle({
      type: "DISCOVER_FILE",
      operationId: "configured",
      file: logFile([HEADER, DAMAGE, DAMAGE.replace("01.0000", "09.0000")]),
      options: { inactivityThresholdMs: 5_000 },
    });
    await waitFor(
      () =>
        responses.some((response) => response.type === "DISCOVERY_COMPLETE"),
      "configured discovery did not complete",
    );
    const complete = responses.find(
      (response) => response.type === "DISCOVERY_COMPLETE",
    );
    expect(
      complete?.type === "DISCOVERY_COMPLETE"
        ? complete.result.sessions.filter(
            (session) => session.playerGuid === "Player-1",
          )
        : [],
    ).toHaveLength(2);
  });

  it("cancels without stale completion and successfully reuses the runtime", async () => {
    const responses: WorkerResponse[] = [];
    const runtime = new ParserWorkerRuntime((response) => {
      responses.push(response);
      if (
        response.type === "PROGRESS" &&
        response.progress.operationId === "cancel-me" &&
        response.progress.phase === "scanning-actors" &&
        response.progress.bytesProcessed > 0
      ) {
        runtime.handle({ type: "CANCEL", operationId: "cancel-me" });
      }
    });
    const large = logFile([
      HEADER,
      ...Array.from({ length: 4_000 }, () => DAMAGE),
    ]);
    runtime.handle({
      type: "DISCOVER_FILE",
      operationId: "cancel-me",
      file: large,
    });
    await waitFor(
      () =>
        responses.some(
          (response) =>
            response.type === "ERROR" &&
            response.operationId === "cancel-me" &&
            response.error.category === "cancelled",
        ),
      "cancellation was not reported",
    );
    await delay(5);
    expect(
      responses.some(
        (response) =>
          response.type === "DISCOVERY_COMPLETE" &&
          response.operationId === "cancel-me",
      ),
    ).toBe(false);

    runtime.handle({
      type: "DISCOVER_FILE",
      operationId: "reuse",
      file: logFile(),
    });
    await waitFor(
      () =>
        responses.some(
          (response) =>
            response.type === "DISCOVERY_COMPLETE" &&
            response.operationId === "reuse",
        ),
      "reused worker did not complete",
    );
  });
});

describe("PROCESS_SESSION lifecycle and cancellation races", () => {
  it("routes typed process progress and completion through an installed D06 processor", async () => {
    const fakeSession = { id: "processed" } as unknown as Session;
    const processor: SessionProcessor = (_file, _selection, context) => {
      context.reportProgress("filtering-events", 10, "Filtering events");
      context.reportProgress("building-result", 20, "Building result");
      return Promise.resolve({ ok: true, value: fakeSession, warnings: [] });
    };
    const responses: WorkerResponse[] = [];
    const runtime = new ParserWorkerRuntime(
      (response) => responses.push(response),
      processor,
    );
    runtime.handle({
      type: "PROCESS_SESSION",
      operationId: "process-1",
      file: logFile(),
      selection: selection(),
    });
    await waitFor(
      () => responses.some((response) => response.type === "SESSION_COMPLETE"),
      "session did not complete",
    );
    expect(
      responses
        .filter((response) => response.type === "PROGRESS")
        .map((response) => response.progress.phase),
    ).toEqual(["processing-session", "filtering-events", "building-result"]);
    expect(responses.at(-1)).toEqual({
      type: "SESSION_COMPLETE",
      operationId: "process-1",
      session: fakeSession,
    });
  });

  it("suppresses a late process result after cancellation or supersession", async () => {
    let release: ((result: OperationResult<Session>) => void) | undefined;
    const processor: SessionProcessor = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const responses: WorkerResponse[] = [];
    const runtime = new ParserWorkerRuntime(
      (response) => responses.push(response),
      processor,
    );
    runtime.handle({
      type: "PROCESS_SESSION",
      operationId: "old-process",
      file: logFile(),
      selection: selection(),
    });
    await waitFor(() => release !== undefined, "processor did not start");
    runtime.handle({
      type: "DISCOVER_FILE",
      operationId: "replacement",
      file: logFile(),
    });
    release?.({
      ok: true,
      value: { id: "stale" } as unknown as Session,
      warnings: [],
    });
    await waitFor(
      () =>
        responses.some(
          (response) =>
            response.type === "DISCOVERY_COMPLETE" &&
            response.operationId === "replacement",
        ),
      "replacement did not finish",
    );
    expect(
      responses.some(
        (response) =>
          response.type === "SESSION_COMPLETE" &&
          response.operationId === "old-process",
      ),
    ).toBe(false);
  });

  it("runs the real streaming processor, cancels without stale completion, and reuses the worker", async () => {
    const responses: WorkerResponse[] = [];
    const runtime = new ParserWorkerRuntime((response) => {
      responses.push(response);
      if (
        response.type === "PROGRESS" &&
        response.progress.operationId === "cancel-real" &&
        response.progress.phase === "processing-session" &&
        response.progress.bytesProcessed > 0
      ) {
        runtime.handle({ type: "CANCEL", operationId: "cancel-real" });
      }
    }, processSessionFile);
    runtime.handle({
      type: "PROCESS_SESSION",
      operationId: "cancel-real",
      file: logFile([HEADER, ...Array.from({ length: 2_000 }, () => DAMAGE)]),
      selection: selection(),
    });
    await waitFor(
      () =>
        responses.some(
          (response) =>
            response.type === "ERROR" &&
            response.operationId === "cancel-real" &&
            response.error.category === "cancelled",
        ),
      "real processor cancellation was not reported",
    );
    await delay(5);
    expect(
      responses.some(
        (response) =>
          response.type === "SESSION_COMPLETE" &&
          response.operationId === "cancel-real",
      ),
    ).toBe(false);

    const reuseFile = logFile();
    runtime.handle({
      type: "PROCESS_SESSION",
      operationId: "reuse-real",
      file: reuseFile,
      selection: selection(),
      options: { preRollMs: 0, postRollMs: 0 },
    });
    await waitFor(
      () =>
        responses.some(
          (response) =>
            response.type === "SESSION_COMPLETE" &&
            response.operationId === "reuse-real",
        ),
      "reused real processor did not complete",
    );
    const complete = responses.find(
      (response) =>
        response.type === "SESSION_COMPLETE" &&
        response.operationId === "reuse-real",
    );
    expect(
      complete?.type === "SESSION_COMPLETE" ? complete.session : undefined,
    ).toMatchObject({
      id: "session-1",
      player: { guid: "Player-1", relationship: "primary" },
      targets: [{ guid: "Creature-1", relationship: "target" }],
    });
    if (complete?.type !== "SESSION_COMPLETE") return;
    const progress = responses
      .filter(
        (response) =>
          response.type === "PROGRESS" &&
          response.progress.operationId === "reuse-real",
      )
      .map((response) =>
        response.type === "PROGRESS" ? response.progress : undefined,
      )
      .filter((value) => value !== undefined);
    expect(
      progress.every(
        (item) =>
          item.bytesProcessed >= 0 && item.bytesProcessed <= reuseFile.size,
      ),
    ).toBe(true);
    expect(Math.max(...progress.map((item) => item.bytesProcessed))).toBe(
      complete.session.statistics.filtering.bytesRead,
    );
  });
});

class FakeWorker implements WorkerTransport {
  readonly requests: WorkerRequest[] = [];
  readonly #listeners = new Set<(event: WorkerMessageEvent) => void>();
  terminated = false;

  postMessage(message: WorkerRequest): void {
    this.requests.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: WorkerMessageEvent) => void,
  ): void {
    this.#listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: WorkerMessageEvent) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: WorkerResponse): void {
    const event: WorkerMessageEvent = { data: response };
    for (const listener of this.#listeners) listener(event);
  }
}

describe("main-thread stale-message guard", () => {
  it("settles superseded work as cancelled and ignores stale responses", async () => {
    const worker = new FakeWorker();
    const client = new ParserWorkerClient(worker);
    const first = client.discover(logFile());
    const second = client.discover(logFile());
    expect(await first).toMatchObject({
      ok: false,
      error: { category: "cancelled" },
    });
    expect(worker.requests.map((request) => request.type)).toEqual([
      "DISCOVER_FILE",
      "CANCEL",
      "DISCOVER_FILE",
    ]);
    const secondRequest = worker.requests[2];
    if (secondRequest?.type !== "DISCOVER_FILE") {
      throw new Error("expected a replacement discovery request");
    }
    worker.emit({
      type: "DISCOVERY_COMPLETE",
      operationId: "worker-operation-1",
      result: {} as unknown as DiscoveryResult,
      warnings: [],
    });
    worker.emit({
      type: "ERROR",
      operationId: secondRequest.operationId,
      error: {
        category: "invalid-combat-log",
        code: "TEST_END",
        message: "test terminal response",
        recoverable: true,
      },
    });
    expect(await second).toMatchObject({
      ok: false,
      error: { code: "TEST_END" },
    });
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("carries explicit extraction options through PROCESS_SESSION", async () => {
    const worker = new FakeWorker();
    const client = new ParserWorkerClient(worker);
    const pending = client.process(logFile(), selection(), {
      extractionOptions: {
        preRollMs: 1_000,
        postRollMs: 2_000,
        budgets: { hardRetainedEventLimit: 50 },
        includeDebugDecisions: true,
      },
    });
    const request = worker.requests[0];
    expect(request).toMatchObject({
      type: "PROCESS_SESSION",
      options: {
        preRollMs: 1_000,
        postRollMs: 2_000,
        budgets: { hardRetainedEventLimit: 50 },
        includeDebugDecisions: true,
      },
    });
    if (request?.type !== "PROCESS_SESSION")
      throw new Error("expected a process request");
    worker.emit({
      type: "ERROR",
      operationId: request.operationId,
      error: {
        category: "internal",
        code: "TEST_END",
        message: "test terminal response",
        recoverable: true,
      },
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "TEST_END" },
    });
    client.dispose();
  });
});
