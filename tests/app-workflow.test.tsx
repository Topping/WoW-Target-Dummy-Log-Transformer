// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AppError,
  DiscoveryResult,
  OperationResult,
  ParserWarning,
  ProcessingProgress,
  Session,
  SessionSelection,
} from "../src/core";
import { App } from "../src/ui/App";
import type {
  DiscoverWorkerOperationOptions,
  ProcessWorkerOperationOptions,
  SavedSessionDownload,
} from "../src/worker";
import { saveSessionDownload } from "../src/worker";
import { makeCandidate, makeDiscovery, makeSession } from "./ui-fixtures";

interface PendingOperation<T> {
  readonly options: {
    readonly onProgress?: (progress: ProcessingProgress) => void;
  };
  readonly resolve: (result: OperationResult<T>) => void;
}

class FakeAnalyzerClient {
  readonly discoveries: PendingOperation<DiscoveryResult>[] = [];
  readonly processes: PendingOperation<Session>[] = [];
  readonly selections: SessionSelection[] = [];
  cancelCount = 0;
  disposed = false;

  discover(
    _file: File,
    options: DiscoverWorkerOperationOptions = {},
  ): Promise<OperationResult<DiscoveryResult>> {
    return new Promise((resolve) => {
      this.discoveries.push({ options, resolve });
    });
  }

  process(
    _file: File,
    selection: SessionSelection,
    options: ProcessWorkerOperationOptions = {},
  ): Promise<OperationResult<Session>> {
    this.selections.push(selection);
    return new Promise((resolve) => {
      this.processes.push({ options, resolve });
    });
  }

  cancel(): void {
    this.cancelCount += 1;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function success<T>(
  value: T,
  warnings: readonly ParserWarning[] = [],
): OperationResult<T> {
  return { ok: true, value, warnings };
}

function failure(error: AppError): OperationResult<never> {
  return { ok: false, error, warnings: [] };
}

function progress(
  phase: ProcessingProgress["phase"],
  bytesProcessed: number,
  totalBytes = 100,
): ProcessingProgress {
  return {
    operationId: "worker-operation",
    phase,
    bytesProcessed,
    totalBytes,
    status: "Worker status",
  };
}

function file(name = "renamed.data"): File {
  return new File(["x".repeat(100)], name, {
    type: "application/octet-stream",
  });
}

async function uploadFile(
  user: ReturnType<typeof userEvent.setup>,
  value = file(),
) {
  const input = screen.getByLabelText("Choose a WoW combat log file");
  await user.upload(input, value);
}

async function reachProcessing(
  user: ReturnType<typeof userEvent.setup>,
  client: FakeAnalyzerClient,
  discovery = makeDiscovery(),
): Promise<void> {
  await uploadFile(user);
  client.discoveries[0]?.resolve(success(discovery));
  await screen.findByRole("heading", {
    name: "Preparing encounter log",
  });
}

async function reachResult(
  user: ReturnType<typeof userEvent.setup>,
  client: FakeAnalyzerClient,
): Promise<void> {
  await reachProcessing(user, client);
  client.processes[0]?.resolve(success(makeSession()));
  await screen.findByRole("heading", { name: "Your encounter log is ready" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("browser-oriented D08-D09 workflow", () => {
  it("supports keyboard file intake and drag-and-drop without trusting the filename", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    const inputClick = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { unmount } = render(<App createWorkerClient={() => client} />);

    expect(screen.getByRole("heading", { name: "How to use it" })).toBeTruthy();
    const choose = screen.getByRole("button", { name: "Choose combat log" });
    choose.focus();
    await user.keyboard("{Enter}");
    expect(inputClick).toHaveBeenCalledOnce();

    const dropZone = screen.getByText(
      /Drop WoWCombatLog\.txt here/u,
    ).parentElement;
    if (dropZone === null) throw new Error("drop zone not found");
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file("not-a-log.bin")] },
    });
    expect(await screen.findAllByText(/not-a-log\.bin/u)).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "How to use it" })).toBeNull();
    expect(client.discoveries).toHaveLength(1);

    unmount();
    expect(client.disposed).toBe(true);
  });

  it("starts over to the drop area and cancels active work", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);

    await uploadFile(user);
    await screen.findByRole("heading", { name: "Scanning combat log" });
    expect(
      screen.queryByRole("button", { name: "Choose another file" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(client.cancelCount).toBe(1);
    expect(
      screen.getByRole("heading", { name: "Choose your combat log" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How to use it" })).toBeTruthy();
  });

  it("runs the common file → automatic attempt → encounter export path", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    const download = vi.fn(
      (
        _session: Session,
        kind: "json" | "encounter-log",
      ): OperationResult<SavedSessionDownload> =>
        success({
          filename:
            kind === "json"
              ? "character.session.json"
              : "character.session.encounter.txt",
        }),
    );
    render(
      <App createWorkerClient={() => client} downloadSession={download} />,
    );

    await uploadFile(user);
    client.discoveries[0]?.options.onProgress?.(
      progress("scanning-actors", 68),
    );
    expect(await screen.findByText("68%", { selector: "p" })).toBeTruthy();
    client.discoveries[0]?.resolve(success(makeDiscovery()));

    const processingHeading = await screen.findByRole("heading", {
      name: "Preparing encounter log",
    });
    expect(document.activeElement).toBe(processingHeading);
    expect(client.processes).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Player-Recorder");
    expect(client.selections[0]?.targetGuids).toHaveLength(5);
    client.processes[0]?.options.onProgress?.(progress("filtering-events", 80));
    expect(await screen.findByText("80%", { selector: "p" })).toBeTruthy();
    client.processes[0]?.resolve(success(makeSession()));

    await screen.findByRole("heading", { name: "Your encounter log is ready" });
    expect(screen.getByText("1m 27.413s · 5 targets")).toBeTruthy();
    expect(
      screen.getByText("This complete session is unusually large."),
    ).toBeTruthy();
    const details = screen.getByText("View attempt details").closest("details");
    expect(details).toHaveProperty("open", false);
    expect(
      screen.queryByRole("button", { name: "Export session JSON" }),
    ).toBeNull();

    const downloadButton = screen.getByRole("button", {
      name: "Download encounter log",
    });
    expect(
      downloadButton.compareDocumentPosition(details as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(downloadButton);
    expect(download).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledWith(expect.anything(), "encounter-log");
    expect(
      await screen.findByText(/character\.session\.encounter\.txt is ready/u),
    ).toBeTruthy();

    await user.click(screen.getByText("View attempt details"));
    expect(screen.getByText("Risen Ghoul")).toBeTruthy();
    expect(screen.getByText("Technical details")).toBeTruthy();
  });

  it("requires explicit choice when no unique recorder exists and shows every character", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await uploadFile(user);
    client.discoveries[0]?.resolve(success(makeDiscovery(null)));

    await screen.findByRole("heading", {
      name: "Choose your character",
    });
    expect(
      screen.getByRole("radio", { name: "Pølsefatter-ArgentDawn-EU" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Nearby-MoonGuard-US" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(
      screen.getByRole("radio", { name: "Nearby-MoonGuard-US" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", {
        name: "Choose an attempt",
      }),
    ).toBeTruthy();
  });

  it("also requires explicit choice when multiple characters are marked as recorder candidates", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    const base = makeDiscovery(null);
    const multiple = {
      ...base,
      players: base.players.map((player) => ({
        ...player,
        recorderCandidate: true,
      })),
    };
    render(<App createWorkerClient={() => client} />);
    await uploadFile(user);
    client.discoveries[0]?.resolve(success(multiple));
    expect(
      await screen.findByRole("heading", {
        name: "Choose your character",
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("uses direct actions when more than one likely attempt needs a choice", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    const discovery = makeDiscovery();
    render(<App createWorkerClient={() => client} />);
    await uploadFile(user);
    client.discoveries[0]?.resolve(
      success({
        ...discovery,
        sessions: [
          discovery.sessions[0] ?? makeCandidate("first"),
          makeCandidate("second-likely"),
          ...discovery.sessions.slice(1),
        ],
      }),
    );

    await screen.findByRole("heading", { name: "Choose an attempt" });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Process selected attempt" }),
    ).toBeNull();
    const actions = screen.getAllByRole("button", { name: "Use this attempt" });
    expect(actions.length).toBeGreaterThanOrEqual(2);
    const secondAction = actions[1];
    if (secondAction === undefined) throw new Error("missing second attempt");
    await user.click(secondAction);
    expect(client.selections[0]?.id).toBe("second-likely");
    await screen.findByRole("heading", { name: "Preparing encounter log" });
  });

  it.each([
    [
      "no-player-characters" as const,
      "No player characters were found",
      "No characters were detected.",
    ],
    [
      "file-unreadable" as const,
      "The file couldn't be read",
      "The browser could not read this file.",
    ],
    [
      "unsupported-log-format" as const,
      "This combat-log format isn't supported yet",
      "This game version is not supported.",
    ],
  ])(
    "renders a useful %s recovery state",
    async (category, heading, message) => {
      const user = userEvent.setup();
      const client = new FakeAnalyzerClient();
      render(<App createWorkerClient={() => client} />);
      await uploadFile(user);
      client.discoveries[0]?.resolve(
        failure({
          category,
          code: "TEST_RECOVERY",
          message,
          recoverable: true,
          suggestedAction: "Start over with another file or try again.",
        }),
      );
      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeTruthy();
      expect(screen.getByText(message)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Try this file again" }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
    },
  );

  it("shows helpful no-session and invalid-file recovery with retry", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await uploadFile(user);
    client.discoveries[0]?.resolve(
      failure({
        category: "invalid-combat-log",
        code: "UNRELATED_FILE_CONTENT",
        message:
          "The selected file does not look like a complete WoW combat log.",
        recoverable: true,
        suggestedAction: "Choose WoWCombatLog.txt from the game's Logs folder.",
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "This doesn't look like a supported WoW combat log",
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Try this file again" }),
    );
    expect(client.discoveries).toHaveLength(2);
    client.discoveries[1]?.resolve(
      success({ ...makeDiscovery(), sessions: [] }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "No training sessions found for this character",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/fight continuously for at least 20–30 seconds/u),
    ).toBeTruthy();
  });

  it("handles cancellation, stale completion, replacement files, and processing retry", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await uploadFile(user);
    await user.click(screen.getByRole("button", { name: "Cancel scanning" }));
    expect(await screen.findByText("File scanning was cancelled")).toBeTruthy();
    client.discoveries[0]?.resolve(success(makeDiscovery()));
    await waitFor(() => {
      expect(screen.queryByText("Preparing encounter log")).toBeNull();
    });

    await user.click(
      screen.getByRole("button", { name: "Scan this file again" }),
    );
    client.discoveries[1]?.resolve(success(makeDiscovery()));
    await screen.findByRole("heading", { name: "Preparing encounter log" });
    await user.click(screen.getByRole("button", { name: "Cancel processing" }));
    expect(
      await screen.findByText("Session processing was cancelled"),
    ).toBeTruthy();
    client.processes[0]?.resolve(success(makeSession()));
    expect(screen.queryByText("Your encounter log is ready")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to sessions" }));
    expect(await screen.findByText(/Processing was cancelled/u)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Start over" }));
    const dropZone = screen.getByText(
      /Drop WoWCombatLog\.txt here/u,
    ).parentElement;
    if (dropZone === null) throw new Error("drop zone not found");
    const replacementFile = file("replacement-file.weird");
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [replacementFile] },
    });
    expect(await screen.findAllByText(/replacement-file\.weird/u)).toHaveLength(
      1,
    );
    expect(client.discoveries).toHaveLength(3);
  });

  it("surfaces a recoverable processing error and a hard export failure", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    const hardError: AppError = {
      category: "session-too-large",
      code: "EXPORT_HARD_BYTE_LIMIT_EXCEEDED",
      message: "The generated export exceeds the configured hard byte limit.",
      recoverable: true,
      suggestedAction: "Choose a narrower session.",
    };
    const download = vi.fn((): OperationResult<SavedSessionDownload> =>
      failure(hardError),
    );
    render(
      <App createWorkerClient={() => client} downloadSession={download} />,
    );
    await reachProcessing(user, client);
    client.processes[0]?.resolve(
      failure({
        category: "session-too-large",
        code: "SESSION_HARD_EVENT_LIMIT_EXCEEDED",
        message: "The selected session exceeded the event limit.",
        recoverable: true,
        suggestedAction: "Choose a narrower session.",
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "This session is too large for the current limit",
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry processing" }));
    client.processes[1]?.resolve(success(makeSession()));
    await screen.findByRole("heading", { name: "Your encounter log is ready" });
    await user.click(
      screen.getByRole("button", { name: "Download encounter log" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The generated export exceeds the configured hard byte limit.",
    );
  });

  it("revokes the object URL after handing a deterministic download to the browser", () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-download");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const result = saveSessionDownload(makeSession(), "json");
    expect(result.ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-download");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("can start over from a result and drop another file", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await reachResult(user, client);
    await user.click(screen.getByRole("button", { name: "Start over" }));
    const dropZone = screen.getByText(
      /Drop WoWCombatLog\.txt here/u,
    ).parentElement;
    if (dropZone === null) throw new Error("drop zone not found");
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file("another-capture.txt")] },
    });
    expect(await screen.findAllByText(/another-capture\.txt/u)).toHaveLength(1);
    expect(client.discoveries).toHaveLength(2);
  });

  it("renders an optional focus target and provides result navigation", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await reachProcessing(user, client);
    const base = makeSession();
    const target = base.targets[0];
    const statistics = base.statistics.targets[0];
    client.processes[0]?.resolve(
      success({
        ...base,
        targets: [target],
        focusTargetGuid: target.guid,
        statistics: { ...base.statistics, targets: [statistics] },
      }),
    );
    await user.click(await screen.findByText("View attempt details"));
    expect(
      await screen.findByText("Focus: Cleave Training Dummy"),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Choose a different attempt" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Choose an attempt",
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change character" }));
    expect(
      await screen.findByRole("heading", {
        name: "Choose your character",
      }),
    ).toBeTruthy();
  });
});
