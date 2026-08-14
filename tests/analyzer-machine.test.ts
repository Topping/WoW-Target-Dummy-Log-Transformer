import { File } from "node:buffer";

import { describe, expect, it } from "vitest";

import type { AppError, ProcessingProgress } from "../src/core";
import {
  analyzerReducer,
  initialAnalyzerState,
  type AnalyzerState,
} from "../src/ui/analyzerMachine";
import { makeCandidate, makeDiscovery, makeSession } from "./ui-fixtures";

const file = new File(["log"], "first.data");
const replacement = new File(["replacement"], "replacement.txt");
const discovery = makeDiscovery();
const candidate = makeCandidate("likely-five-targets");
const error: AppError = {
  category: "invalid-combat-log",
  code: "TEST_ERROR",
  message: "Test error",
  recoverable: true,
};
const progress: ProcessingProgress = {
  operationId: "worker-operation",
  phase: "scanning-actors",
  bytesProcessed: 2,
  totalBytes: 3,
  status: "Scanning",
};

function startDiscovery(): AnalyzerState {
  return analyzerReducer(initialAnalyzerState, {
    type: "START_DISCOVERY",
    file,
    operationId: "discover-1",
  });
}

function reachSessions(): Extract<
  AnalyzerState,
  { status: "session-selection" }
> {
  let state = startDiscovery();
  state = analyzerReducer(state, {
    type: "DISCOVERY_SUCCEEDED",
    operationId: "discover-1",
    discovery,
    warnings: [],
  });
  state = analyzerReducer(state, { type: "CONFIRM_RECORDER" });
  if (state.status !== "session-selection")
    throw new Error("expected sessions");
  return state;
}

describe("analyzer UI state machine", () => {
  it("covers discovery progress, recorder confirmation, character change, and session selection", () => {
    let state = startDiscovery();
    state = analyzerReducer(state, {
      type: "DISCOVERY_PROGRESS",
      operationId: "discover-1",
      progress,
    });
    expect(state).toMatchObject({ status: "discovering", progress });
    state = analyzerReducer(state, {
      type: "DISCOVERY_SUCCEEDED",
      operationId: "discover-1",
      discovery,
      warnings: [],
    });
    expect(state).toMatchObject({
      status: "recorder-confirmation",
      playerGuid: "Player-Recorder",
    });
    state = analyzerReducer(state, { type: "CHANGE_CHARACTER" });
    expect(state).toMatchObject({
      status: "character-selection",
      selectedPlayerGuid: "Player-Recorder",
    });
    state = analyzerReducer(state, {
      type: "SELECT_CHARACTER",
      playerGuid: "Player-Other",
    });
    state = analyzerReducer(state, { type: "CONTINUE_CHARACTER" });
    expect(state).toMatchObject({
      status: "session-selection",
      playerGuid: "Player-Other",
    });
  });

  it("requires explicit selection for zero recorder candidates and lists all players", () => {
    let state = startDiscovery();
    state = analyzerReducer(state, {
      type: "DISCOVERY_SUCCEEDED",
      operationId: "discover-1",
      discovery: makeDiscovery(null),
      warnings: [],
    });
    expect(state).toMatchObject({ status: "character-selection" });
    if (state.status !== "character-selection") return;
    expect(state.discovery.players).toHaveLength(2);
    expect(analyzerReducer(state, { type: "CONTINUE_CHARACTER" })).toBe(state);
  });

  it("maps an empty successful player list to a recoverable no-player error", () => {
    const empty = { ...makeDiscovery(null), players: [] };
    const state = analyzerReducer(startDiscovery(), {
      type: "DISCOVERY_SUCCEEDED",
      operationId: "discover-1",
      discovery: empty,
      warnings: [],
    });
    expect(state).toMatchObject({
      status: "error",
      source: "discovery",
      error: { category: "no-player-characters", recoverable: true },
    });
  });

  it("processes a selected session, records export outcomes, and supports both back paths", () => {
    let state: AnalyzerState = reachSessions();
    state = analyzerReducer(state, {
      type: "SELECT_SESSION",
      sessionId: candidate.id,
    });
    state = analyzerReducer(state, {
      type: "START_PROCESSING",
      candidate,
      operationId: "process-1",
    });
    expect(state).toMatchObject({ status: "processing", candidate });
    state = analyzerReducer(state, {
      type: "PROCESS_PROGRESS",
      operationId: "process-1",
      progress: { ...progress, phase: "filtering-events" },
    });
    state = analyzerReducer(state, {
      type: "PROCESS_SUCCEEDED",
      operationId: "process-1",
      session: makeSession(),
    });
    expect(state).toMatchObject({ status: "result" });
    state = analyzerReducer(state, {
      type: "EXPORT_SUCCEEDED",
      kind: "json",
      filename: "session.json",
      warnings: [],
    });
    expect(state).toMatchObject({
      status: "result",
      exportFeedback: { outcome: "success" },
    });
    state = analyzerReducer(state, {
      type: "EXPORT_FAILED",
      kind: "encounter-log",
      error,
    });
    expect(state).toMatchObject({
      status: "result",
      exportFeedback: { outcome: "error" },
    });
    const sessions = analyzerReducer(state, { type: "RETURN_TO_SESSIONS" });
    expect(sessions).toMatchObject({ status: "session-selection" });
    const character = analyzerReducer(state, { type: "CHANGE_CHARACTER" });
    expect(character).toMatchObject({ status: "character-selection" });
  });

  it("cancels discovery, ignores late results, retries, and accepts replacement files", () => {
    let state = startDiscovery();
    state = analyzerReducer(state, {
      type: "CANCEL_OPERATION",
      operationId: "discover-1",
    });
    expect(state).toMatchObject({ status: "cancelled", stage: "discovery" });
    const stale = analyzerReducer(state, {
      type: "DISCOVERY_SUCCEEDED",
      operationId: "discover-1",
      discovery,
      warnings: [],
    });
    expect(stale).toBe(state);
    state = analyzerReducer(state, {
      type: "START_DISCOVERY",
      file,
      operationId: "discover-2",
    });
    state = analyzerReducer(state, {
      type: "START_DISCOVERY",
      file: replacement,
      operationId: "discover-3",
    });
    expect(state).toMatchObject({
      status: "discovering",
      file: replacement,
      operationId: "discover-3",
    });
    expect(
      analyzerReducer(state, {
        type: "DISCOVERY_FAILED",
        operationId: "discover-2",
        error,
      }),
    ).toBe(state);
  });

  it("handles discovery failure and retry without stale progress advancing it", () => {
    let state = analyzerReducer(startDiscovery(), {
      type: "DISCOVERY_FAILED",
      operationId: "discover-1",
      error,
    });
    expect(state).toMatchObject({ status: "error", source: "discovery" });
    state = analyzerReducer(state, {
      type: "START_DISCOVERY",
      file,
      operationId: "discover-2",
    });
    const unchanged = analyzerReducer(state, {
      type: "DISCOVERY_PROGRESS",
      operationId: "discover-1",
      progress,
    });
    expect(unchanged).toBe(state);
  });

  it("cancels processing, ignores stale completion, and returns coherently to sessions", () => {
    let state: AnalyzerState = reachSessions();
    state = analyzerReducer(state, {
      type: "START_PROCESSING",
      candidate,
      operationId: "process-1",
    });
    state = analyzerReducer(state, {
      type: "CANCEL_OPERATION",
      operationId: "process-1",
    });
    expect(state).toMatchObject({ status: "cancelled", stage: "processing" });
    expect(
      analyzerReducer(state, {
        type: "PROCESS_SUCCEEDED",
        operationId: "process-1",
        session: makeSession(),
      }),
    ).toBe(state);
    state = analyzerReducer(state, {
      type: "RETURN_TO_SESSIONS",
      notice: "Cancelled",
    });
    expect(state).toMatchObject({
      status: "session-selection",
      notice: "Cancelled",
    });
  });

  it("supports processing failure, retry, and reset", () => {
    let state: AnalyzerState = reachSessions();
    state = analyzerReducer(state, {
      type: "START_PROCESSING",
      candidate,
      operationId: "process-1",
    });
    state = analyzerReducer(state, {
      type: "PROCESS_FAILED",
      operationId: "process-1",
      error,
    });
    expect(state).toMatchObject({ status: "error", source: "processing" });
    state = analyzerReducer(state, {
      type: "START_PROCESSING",
      candidate,
      operationId: "process-2",
    });
    expect(state).toMatchObject({
      status: "processing",
      operationId: "process-2",
    });
    expect(analyzerReducer(state, { type: "RESET" })).toEqual({
      status: "waiting",
    });
  });
});
