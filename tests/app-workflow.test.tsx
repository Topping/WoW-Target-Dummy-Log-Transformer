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
import { makeDiscovery, makeSession } from "./ui-fixtures";

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

async function reachSessionSelection(
  user: ReturnType<typeof userEvent.setup>,
  client: FakeAnalyzerClient,
  discovery = makeDiscovery(),
): Promise<void> {
  await uploadFile(user);
  client.discoveries[0]?.resolve(success(discovery));
  await screen.findByRole("heading", {
    name: "Is this the character that recorded the log?",
  });
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", {
    name: /Training sessions for Pølsefatter/u,
  });
}

async function reachResult(
  user: ReturnType<typeof userEvent.setup>,
  client: FakeAnalyzerClient,
): Promise<void> {
  await reachSessionSelection(user, client);
  await user.click(
    screen.getByRole("radio", { name: /Likely training attempt/u }),
  );
  await user.click(
    screen.getByRole("button", { name: "Process selected attempt" }),
  );
  client.processes[0]?.resolve(success(makeSession()));
  await screen.findByRole("heading", { name: "Your clean training session" });
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

    const choose = screen.getByRole("button", { name: "Choose a combat log" });
    choose.focus();
    await user.keyboard("{Enter}");
    expect(inputClick).toHaveBeenCalledOnce();

    const dropZone = screen.getByText(
      "Drop your WoW combat log here",
    ).parentElement;
    if (dropZone === null) throw new Error("drop zone not found");
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file("not-a-log.bin")] },
    });
    expect(await screen.findAllByText(/not-a-log\.bin/u)).toHaveLength(2);
    expect(client.discoveries).toHaveLength(1);

    unmount();
    expect(client.disposed).toBe(true);
  });

  it("runs file → discovery → recorder confirmation → grouped five-target session → processing → summary → exports", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    const download = vi.fn(
      (
        _session: Session,
        kind: "json" | "encounter-log",
      ): OperationResult<SavedSessionDownload> =>
        success(
          {
            filename:
              kind === "json"
                ? "character.session.json"
                : "character.session.encounter.log",
          },
          kind === "json"
            ? [
                {
                  code: "EXPORT_SOFT_BYTE_LIMIT_EXCEEDED",
                  severity: "warning",
                  message: "The export is large but complete.",
                },
              ]
            : [],
        ),
    );
    render(
      <App createWorkerClient={() => client} downloadSession={download} />,
    );

    await uploadFile(user);
    client.discoveries[0]?.options.onProgress?.(
      progress("scanning-actors", 68),
    );
    expect(await screen.findByText("68 B of 100 B read · 68%")).toBeTruthy();
    client.discoveries[0]?.resolve(success(makeDiscovery()));

    const recorderHeading = await screen.findByRole("heading", {
      name: "Is this the character that recorded the log?",
    });
    expect(document.activeElement).toBe(recorderHeading);
    expect(screen.getByText("Pølsefatter-ArgentDawn-EU")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Player-Recorder");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "Likely attempts" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Other possible sessions" }),
    ).toBeTruthy();
    expect(screen.getAllByText(/Target [1-5]:/u)).toHaveLength(5);
    const advanced = screen
      .getByText("Advanced: incidental interactions")
      .closest("details");
    expect(advanced).toHaveProperty("open", false);
    await user.click(
      screen.getByRole("radio", { name: /Likely training attempt/u }),
    );
    await user.click(
      screen.getByRole("button", { name: "Process selected attempt" }),
    );
    expect(client.selections[0]?.targetGuids).toHaveLength(5);
    client.processes[0]?.options.onProgress?.(progress("filtering-events", 80));
    expect(
      await screen.findByText("Resolving pets and removing nearby activity"),
    ).toBeTruthy();
    client.processes[0]?.resolve(success(makeSession()));

    await screen.findByRole("heading", { name: "Your clean training session" });
    expect(screen.getByText("All 5 targets")).toBeTruthy();
    expect(screen.getAllByText("42")).toHaveLength(2);
    expect(screen.getByText("Risen Ghoul")).toBeTruthy();
    expect(
      screen.getByText("This complete session is unusually large."),
    ).toBeTruthy();
    expect(screen.getByText("Filtering audit")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Export session JSON" }),
    );
    expect(
      await screen.findByText("The export is large but complete."),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Export encounter combat log" }),
    );
    expect(download).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(/character\.session\.encounter\.log is ready/u),
    ).toBeTruthy();
  });

  it("requires explicit choice when no unique recorder exists and shows every character", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await uploadFile(user);
    client.discoveries[0]?.resolve(success(makeDiscovery(null)));

    await screen.findByRole("heading", {
      name: "Which character do you want to analyze?",
    });
    expect(
      screen.getByRole("radio", { name: "Pølsefatter-ArgentDawn-EU" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Nearby-MoonGuard-US" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue to sessions" }),
    ).toHaveProperty("disabled", true);
    await user.click(
      screen.getByRole("radio", { name: "Nearby-MoonGuard-US" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Continue to sessions" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Training sessions for Nearby-MoonGuard-US",
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
        name: "Which character do you want to analyze?",
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
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
          suggestedAction: "Choose another file or try again.",
        }),
      );
      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeTruthy();
      expect(screen.getByText(message)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Try this file again" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Choose another file" }),
      ).toBeTruthy();
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
    await user.click(await screen.findByRole("button", { name: "Continue" }));
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
      expect(
        screen.queryByText("Is this the character that recorded the log?"),
      ).toBeNull();
    });

    await user.click(
      screen.getByRole("button", { name: "Scan this file again" }),
    );
    client.discoveries[1]?.resolve(success(makeDiscovery()));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await user.click(
      screen.getByRole("radio", { name: /Likely training attempt/u }),
    );
    await user.click(
      screen.getByRole("button", { name: "Process selected attempt" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel processing" }));
    expect(
      await screen.findByText("Session processing was cancelled"),
    ).toBeTruthy();
    client.processes[0]?.resolve(success(makeSession()));
    expect(screen.queryByText("Your clean training session")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to sessions" }));
    expect(await screen.findByText(/Processing was cancelled/u)).toBeTruthy();

    const replacementFile = file("replacement-file.weird");
    await user.upload(
      screen.getByLabelText("Choose a WoW combat log file"),
      replacementFile,
    );
    expect(await screen.findAllByText(/replacement-file\.weird/u)).toHaveLength(
      2,
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
    await reachSessionSelection(user, client);
    await user.click(
      screen.getByRole("radio", { name: /Likely training attempt/u }),
    );
    await user.click(
      screen.getByRole("button", { name: "Process selected attempt" }),
    );
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
    await screen.findByRole("heading", { name: "Your clean training session" });
    await user.click(
      screen.getByRole("button", { name: "Export session JSON" }),
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

  it("can return from a result and choose another file", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await reachResult(user, client);
    await user.upload(
      screen.getByLabelText("Choose a WoW combat log file"),
      file("another-capture.txt"),
    );
    expect(await screen.findAllByText(/another-capture\.txt/u)).toHaveLength(2);
    expect(client.discoveries).toHaveLength(2);
  });

  it("renders an optional focus target and provides result navigation", async () => {
    const user = userEvent.setup();
    const client = new FakeAnalyzerClient();
    render(<App createWorkerClient={() => client} />);
    await reachSessionSelection(user, client);
    await user.click(
      screen.getByRole("radio", { name: /Likely training attempt/u }),
    );
    await user.click(
      screen.getByRole("button", { name: "Process selected attempt" }),
    );
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
    expect(
      await screen.findByText("Focus target: Cleave Training Dummy"),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Select another session" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: /Training sessions for Pølsefatter/u,
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Choose another character" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Which character do you want to analyze?",
      }),
    ).toBeTruthy();
  });
});
