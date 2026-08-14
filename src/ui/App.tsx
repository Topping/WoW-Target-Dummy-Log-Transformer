import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type SyntheticEvent,
} from "react";

import type {
  AppError,
  DiscoveryResult,
  OperationResult,
  ParserWarning,
  ProcessingProgress,
  Session,
  SessionCandidate,
  SessionExportKind,
  SessionSelection,
} from "../core";
import {
  createParserWorkerClient,
  saveSessionDownload,
  type ParserWorkerClient,
  type SavedSessionDownload,
} from "../worker";

import {
  analyzerReducer,
  initialAnalyzerState,
  type AnalyzerState,
} from "./analyzerMachine";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatVisibleTime,
  phaseLabel,
  stringifyTechnicalDetails,
} from "./format";

type AnalyzerWorkerClient = Pick<
  ParserWorkerClient,
  "discover" | "process" | "cancel" | "dispose"
>;

export interface AppProps {
  readonly createWorkerClient?: () => AnalyzerWorkerClient;
  readonly downloadSession?: (
    session: Session,
    kind: SessionExportKind,
  ) => OperationResult<SavedSessionDownload>;
}

function playerName(discovery: DiscoveryResult, guid: string): string {
  return (
    discovery.players.find((player) => player.guid === guid)?.name ??
    "Unnamed character"
  );
}

function targetName(discovery: DiscoveryResult, guid: string): string {
  return (
    discovery.targets.find((target) => target.guid === guid)?.name ??
    "Unnamed target"
  );
}

function sessionSelection(candidate: SessionCandidate): SessionSelection {
  return {
    id: candidate.id,
    playerGuid: candidate.playerGuid,
    targetGuids: candidate.targetGuids,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
  };
}

function ProgressView({
  progress,
  totalBytes,
}: {
  readonly progress: ProcessingProgress | undefined;
  readonly totalBytes: number;
}) {
  const processed = progress?.bytesProcessed ?? 0;
  const total = progress?.totalBytes ?? totalBytes;
  const percentage =
    total === 0 ? 0 : Math.min(100, Math.floor((processed / total) * 100));
  return (
    <div className="progress-panel" aria-live="polite">
      <p className="phase-text">
        {progress === undefined ? "Starting…" : phaseLabel(progress.phase)}
      </p>
      <progress max={total || 1} value={processed}>
        {String(percentage)}%
      </progress>
      <p className="progress-copy">
        {formatBytes(processed)} of {formatBytes(total)} read · {percentage}%
      </p>
      {progress?.status === undefined ? null : (
        <p className="muted">{progress.status}</p>
      )}
    </div>
  );
}

function WarningList({
  warnings,
}: {
  readonly warnings: readonly ParserWarning[];
}) {
  if (warnings.length === 0) return null;
  return (
    <section className="warning-panel" aria-labelledby="warnings-title">
      <h3 id="warnings-title">Warnings</h3>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${String(index)}`}>{warning.message}</li>
        ))}
      </ul>
      <details>
        <summary>Show warning details</summary>
        <pre>{stringifyTechnicalDetails(warnings)}</pre>
      </details>
    </section>
  );
}

function SessionCard({
  candidate,
  discovery,
  selected,
  onSelect,
}: {
  readonly candidate: SessionCandidate;
  readonly discovery: DiscoveryResult;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const targetDamage = candidate.targetGuids
    .map((guid) => discovery.targets.find((target) => target.guid === guid))
    .filter((target) => target !== undefined)
    .reduce((sum, target) => sum + target.damageFromPlayer, 0);
  return (
    <label className={`session-card${selected ? " selected" : ""}`}>
      <input
        type="radio"
        name="session"
        checked={selected}
        onChange={onSelect}
      />
      <span className="session-card-body">
        <span className="session-heading">
          <strong>
            {candidate.confidence === "likely"
              ? "Likely training attempt"
              : candidate.confidence === "possible"
                ? "Possible training attempt"
                : "Incidental interaction"}
          </strong>
          <span>{formatDuration(candidate.durationTicks)}</span>
        </span>
        <span className="time-range">
          {formatVisibleTime(candidate.startTime)} →{" "}
          {formatVisibleTime(candidate.endTime)}
        </span>
        <span className="target-label">
          {candidate.targetGuids.length === 1
            ? "Target"
            : `${String(candidate.targetGuids.length)} targets`}
        </span>
        <ul className="target-list">
          {candidate.targetGuids.map((guid, index) => (
            <li key={guid}>
              {candidate.targetGuids.length > 1
                ? `Target ${String(index + 1)}: `
                : ""}
              {targetName(discovery, guid)}
            </li>
          ))}
        </ul>
        {targetDamage > 0 ? (
          <span className="muted">
            {formatCount(targetDamage)} damage observed against these target
            instances across this file
          </span>
        ) : null}
        <details>
          <summary>Why this session was suggested</summary>
          <ul>
            {candidate.reasons.map((reason) => (
              <li key={reason.code}>{reason.description}</li>
            ))}
          </ul>
        </details>
      </span>
    </label>
  );
}

function SessionGroups({
  state,
  onSelect,
}: {
  readonly state: Extract<AnalyzerState, { status: "session-selection" }>;
  readonly onSelect: (sessionId: string) => void;
}) {
  const sessions = state.discovery.sessions.filter(
    (session) => session.playerGuid === state.playerGuid,
  );
  const likely = sessions.filter((session) => session.confidence === "likely");
  const possible = sessions.filter(
    (session) => session.confidence === "possible",
  );
  const incidental = sessions.filter(
    (session) => session.confidence === "incidental",
  );

  if (likely.length + possible.length === 0) {
    return (
      <div className="empty-state">
        <h3>No training sessions found for this character</h3>
        <p>
          We found the character, but not a deliberate training-dummy attempt.
          Make sure <code>/combatlog</code> was enabled, fight continuously for
          at least 20–30 seconds, and avoid switching between unrelated targets.
        </p>
        {incidental.length > 0 ? (
          <details>
            <summary>Advanced: incidental interactions</summary>
            {incidental.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                selected={state.selectedSessionId === candidate.id}
                onSelect={() => {
                  onSelect(candidate.id);
                }}
              />
            ))}
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {likely.length > 0 ? (
        <section aria-labelledby="likely-title">
          <h3 id="likely-title">Likely attempts</h3>
          <div className="card-stack">
            {likely.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                selected={state.selectedSessionId === candidate.id}
                onSelect={() => {
                  onSelect(candidate.id);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {possible.length > 0 ? (
        <section aria-labelledby="possible-title">
          <h3 id="possible-title">Other possible sessions</h3>
          <p className="muted">
            These were shorter or had less sustained activity, but may still be
            the attempt you want.
          </p>
          <div className="card-stack">
            {possible.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                selected={state.selectedSessionId === candidate.id}
                onSelect={() => {
                  onSelect(candidate.id);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {incidental.length > 0 ? (
        <details className="advanced-panel">
          <summary>Advanced: incidental interactions</summary>
          <div className="card-stack">
            {incidental.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                selected={state.selectedSessionId === candidate.id}
                onSelect={() => {
                  onSelect(candidate.id);
                }}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function ErrorDetails({ error }: { readonly error: AppError }) {
  return (
    <>
      <p>{error.message}</p>
      {error.suggestedAction === undefined ? null : (
        <p className="muted">{error.suggestedAction}</p>
      )}
      {error.technicalDetails === undefined ? null : (
        <details>
          <summary>Show technical details</summary>
          <pre>{stringifyTechnicalDetails(error.technicalDetails)}</pre>
        </details>
      )}
    </>
  );
}

function Summary({
  state,
  onExport,
}: {
  readonly state: Extract<AnalyzerState, { status: "result" }>;
  readonly onExport: (kind: SessionExportKind) => void;
}) {
  const { session } = state;
  const controlled = session.actors.filter(
    (actor) => actor.relationship === "owned-by-primary",
  );
  const focus = session.targets.find(
    (target) => target.guid === session.focusTargetGuid,
  );
  const allWarnings = [...state.discoveryWarnings, ...session.warnings];
  const technical = {
    parser: session.parser,
    playerGuid: session.player.guid,
    targetGuids: session.targets.map((target) => target.guid),
    focusTargetGuid: session.focusTargetGuid,
    actors: session.actors,
    warnings: allWarnings,
    debugDecisions: session.debugDecisions,
  };
  return (
    <div className="summary-layout">
      <section className="summary-card" aria-labelledby="overview-title">
        <h3 id="overview-title">Attempt overview</h3>
        <dl className="summary-list">
          <div>
            <dt>Character</dt>
            <dd>{session.player.name ?? "Unnamed character"}</dd>
          </div>
          <div>
            <dt>Visible range</dt>
            <dd>
              {formatVisibleTime(session.startTime)} →{" "}
              {formatVisibleTime(session.endTime)}
            </dd>
          </div>
          <div>
            <dt>Exact duration</dt>
            <dd>{formatDuration(session.durationTicks)}</dd>
          </div>
          <div>
            <dt>Relevant events</dt>
            <dd>{formatCount(session.statistics.relevantEventCount)}</dd>
          </div>
          <div>
            <dt>Nearby events removed</dt>
            <dd>{formatCount(session.statistics.removedEventCount)}</dd>
          </div>
          <div>
            <dt>External effects</dt>
            <dd>{formatCount(session.statistics.externalEffectCount)}</dd>
          </div>
          <div>
            <dt>Unknown event types</dt>
            <dd>{formatCount(session.statistics.unknownEventTypeCount)}</dd>
          </div>
        </dl>
      </section>

      <section className="summary-card" aria-labelledby="targets-title">
        <h3 id="targets-title">
          {session.targets.length === 1
            ? "Target"
            : `All ${String(session.targets.length)} targets`}
        </h3>
        {focus === undefined ? null : (
          <p className="focus-target">
            Focus target: {focus.name ?? "Unnamed target"}
          </p>
        )}
        <div className="target-stat-grid">
          {session.statistics.targets.map((statistics, index) => {
            const target = session.targets.find(
              (candidate) => candidate.guid === statistics.targetGuid,
            );
            return (
              <article key={statistics.targetGuid}>
                <h4>
                  {session.targets.length > 1
                    ? `Target ${String(index + 1)}: `
                    : ""}
                  {target?.name ?? "Unnamed target"}
                </h4>
                <dl>
                  <div>
                    <dt>Relevant events</dt>
                    <dd>{formatCount(statistics.relevantEventCount)}</dd>
                  </div>
                  <div>
                    <dt>Outgoing / incoming</dt>
                    <dd>
                      {formatCount(statistics.outgoingEventCount)} /{" "}
                      {formatCount(statistics.incomingEventCount)}
                    </dd>
                  </div>
                  <div>
                    <dt>Damage events</dt>
                    <dd>{formatCount(statistics.damageEventCount)}</dd>
                  </div>
                  <div>
                    <dt>Observed damage</dt>
                    <dd>{formatCount(statistics.observedDamageAmount)}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      <section className="summary-card" aria-labelledby="entities-title">
        <h3 id="entities-title">Controlled entities</h3>
        <p>
          {formatCount(session.statistics.controlledEntityCount)} pet, guardian,
          summon, or other controlled{" "}
          {session.statistics.controlledEntityCount === 1
            ? "entity was"
            : "entities were"}{" "}
          retained.
        </p>
        {controlled.length === 0 ? (
          <p className="muted">No controlled entities were detected.</p>
        ) : (
          <ul>
            {controlled.map((actor) => (
              <li key={actor.guid}>
                <strong>{actor.name ?? "Unnamed controlled entity"}</strong>
                {actor.ownershipEvidence === undefined ? null : (
                  <span className="muted">
                    {" "}
                    · evidence: {actor.ownershipEvidence.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="summary-card" aria-labelledby="audit-title">
        <h3 id="audit-title">Filtering audit</h3>
        <p>
          Every record considered in the selected reconstruction window is
          counted here.
        </p>
        <dl className="summary-list compact">
          <div>
            <dt>Records considered</dt>
            <dd>
              {formatCount(session.statistics.filtering.consideredRecordCount)}
            </dd>
          </div>
          <div>
            <dt>Kept</dt>
            <dd>{formatCount(session.statistics.filtering.keptRecordCount)}</dd>
          </div>
          <div>
            <dt>Removed</dt>
            <dd>
              {formatCount(session.statistics.filtering.removedRecordCount)}
            </dd>
          </div>
          <div>
            <dt>Skipped before pre-roll</dt>
            <dd>
              {formatCount(
                session.statistics.filtering.skippedBeforePreRollCount,
              )}
            </dd>
          </div>
          <div>
            <dt>Source bytes read</dt>
            <dd>{formatBytes(session.statistics.filtering.bytesRead)}</dd>
          </div>
          <div>
            <dt>Retained source bytes</dt>
            <dd>
              {formatBytes(session.statistics.filtering.estimatedRetainedBytes)}
            </dd>
          </div>
        </dl>
        <details>
          <summary>Show kept and removed reasons</summary>
          <div className="audit-reasons">
            <div>
              <h4>Kept</h4>
              <ul>
                {Object.entries(session.statistics.filtering.keptByReason).map(
                  ([reason, count]) => (
                    <li key={reason}>
                      {reason}: {formatCount(count)}
                    </li>
                  ),
                )}
              </ul>
            </div>
            <div>
              <h4>Removed</h4>
              <ul>
                {Object.entries(
                  session.statistics.filtering.removedByReason,
                ).map(([reason, count]) => (
                  <li key={reason}>
                    {reason}: {formatCount(count)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </section>

      <WarningList warnings={allWarnings} />

      <section className="export-panel" aria-labelledby="export-title">
        <h3 id="export-title">Download your clean session</h3>
        <p>
          JSON is the complete normalized session. The filtered log preserves
          the original retained combat-log lines.
        </p>
        <div className="button-row">
          <button
            type="button"
            onClick={() => {
              onExport("json");
            }}
          >
            Export session JSON
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onExport("filtered-log");
            }}
          >
            Export filtered combat log
          </button>
        </div>
        {state.exportFeedback === undefined ? null : (
          <div
            className={
              state.exportFeedback.outcome === "error"
                ? "export-feedback error-copy"
                : "export-feedback"
            }
            role={state.exportFeedback.outcome === "error" ? "alert" : "status"}
          >
            <p>{state.exportFeedback.message}</p>
            {state.exportFeedback.warnings.map((warning) => (
              <p key={warning.code}>{warning.message}</p>
            ))}
            {state.exportFeedback.error?.suggestedAction ===
            undefined ? null : (
              <p>{state.exportFeedback.error.suggestedAction}</p>
            )}
          </div>
        )}
      </section>

      <details className="technical-panel">
        <summary>Technical and debug details</summary>
        <p>
          This section includes actor identifiers and parser details intended
          for troubleshooting.
        </p>
        <pre>{stringifyTechnicalDetails(technical)}</pre>
      </details>
    </div>
  );
}

export function App({
  createWorkerClient = createParserWorkerClient,
  downloadSession = saveSessionDownload,
}: AppProps) {
  const [state, dispatch] = useReducer(analyzerReducer, initialAnalyzerState);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clientRef = useRef<AnalyzerWorkerClient | undefined>(undefined);
  const operationNumber = useRef(0);

  const getClient = useCallback((): AnalyzerWorkerClient => {
    clientRef.current ??= createWorkerClient();
    return clientRef.current;
  }, [createWorkerClient]);

  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.status]);

  const nextOperationId = useCallback((): string => {
    operationNumber.current += 1;
    return `ui-operation-${String(operationNumber.current)}`;
  }, []);

  const startDiscovery = useCallback(
    (file: File): void => {
      const operationId = nextOperationId();
      dispatch({ type: "START_DISCOVERY", file, operationId });
      void getClient()
        .discover(file, {
          onProgress: (progress) => {
            dispatch({ type: "DISCOVERY_PROGRESS", operationId, progress });
          },
        })
        .then((result) => {
          if (result.ok) {
            dispatch({
              type: "DISCOVERY_SUCCEEDED",
              operationId,
              discovery: result.value,
              warnings: result.warnings,
            });
          } else if (result.error.category !== "cancelled") {
            dispatch({
              type: "DISCOVERY_FAILED",
              operationId,
              error: result.error,
            });
          }
        });
    },
    [getClient, nextOperationId],
  );

  const startProcessing = useCallback(
    (file: File, candidate: SessionCandidate): void => {
      const operationId = nextOperationId();
      dispatch({ type: "START_PROCESSING", candidate, operationId });
      void getClient()
        .process(file, sessionSelection(candidate), {
          onProgress: (progress) => {
            dispatch({ type: "PROCESS_PROGRESS", operationId, progress });
          },
        })
        .then((result) => {
          if (result.ok) {
            dispatch({
              type: "PROCESS_SUCCEEDED",
              operationId,
              session: result.value,
            });
          } else if (result.error.category !== "cancelled") {
            dispatch({
              type: "PROCESS_FAILED",
              operationId,
              error: result.error,
            });
          }
        });
    },
    [getClient, nextOperationId],
  );

  const chooseFile = useCallback(() => inputRef.current?.click(), []);
  const receiveFiles = useCallback(
    (files: FileList | readonly File[] | null): void => {
      const file = files?.[0];
      if (file !== undefined) startDiscovery(file);
    },
    [startDiscovery],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragActive(false);
    receiveFiles(event.dataTransfer.files);
  };

  const cancel = (): void => {
    if (state.status !== "discovering" && state.status !== "processing") return;
    const operationId = state.operationId;
    getClient().cancel();
    dispatch({ type: "CANCEL_OPERATION", operationId });
  };

  const exportSession = (kind: SessionExportKind): void => {
    if (state.status !== "result") return;
    try {
      const result = downloadSession(state.session, kind);
      if (result.ok) {
        dispatch({
          type: "EXPORT_SUCCEEDED",
          kind,
          filename: result.value.filename,
          warnings: result.warnings,
        });
      } else {
        dispatch({ type: "EXPORT_FAILED", kind, error: result.error });
      }
    } catch (error: unknown) {
      dispatch({
        type: "EXPORT_FAILED",
        kind,
        error: {
          category: "internal",
          code: "BROWSER_DOWNLOAD_FAILED",
          message: "The browser could not start this download.",
          recoverable: true,
          suggestedAction:
            "Try the export again or check browser download permissions.",
          technicalDetails: {
            details: {
              cause: error instanceof Error ? error.message : String(error),
            },
          },
        },
      });
    }
  };

  const currentFile = "file" in state ? state.file : undefined;

  let workflow: React.ReactNode;
  switch (state.status) {
    case "waiting":
      workflow = (
        <div
          className={`drop-zone${dragActive ? " drag-active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDragLeave={() => {
            setDragActive(false);
          }}
          onDrop={onDrop}
        >
          <div className="file-mark" aria-hidden="true">
            LOG
          </div>
          <h2 ref={headingRef} tabIndex={-1}>
            Drop your WoW combat log here
          </h2>
          <p>
            Any filename is accepted. The analyzer checks the file's contents
            before scanning it.
          </p>
          <button type="button" onClick={chooseFile}>
            Choose a combat log
          </button>
        </div>
      );
      break;
    case "discovering":
      workflow = (
        <section className="workflow-card" aria-labelledby="scan-title">
          <p className="eyebrow">File intake</p>
          <h2 id="scan-title" ref={headingRef} tabIndex={-1}>
            Checking and scanning your combat log
          </h2>
          <p className="file-summary">
            {state.file.name} · {formatBytes(state.file.size)}
          </p>
          <ProgressView
            progress={state.progress}
            totalBytes={state.file.size}
          />
          <button type="button" className="secondary-button" onClick={cancel}>
            Cancel scanning
          </button>
        </section>
      );
      break;
    case "recorder-confirmation":
      workflow = (
        <section className="workflow-card" aria-labelledby="recorder-title">
          <p className="eyebrow">Character found</p>
          <h2 id="recorder-title" ref={headingRef} tabIndex={-1}>
            Is this the character that recorded the log?
          </h2>
          <p className="detected-character">
            {playerName(state.discovery, state.playerGuid)}
          </p>
          <p className="muted">
            The combat log marks this character as yours. You can still choose
            any of the {formatCount(state.discovery.players.length)} detected
            characters.
          </p>
          <div className="button-row">
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "CONFIRM_RECORDER" });
              }}
            >
              Continue
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                dispatch({ type: "CHANGE_CHARACTER" });
              }}
            >
              Change character
            </button>
          </div>
          <WarningList warnings={state.discoveryWarnings} />
        </section>
      );
      break;
    case "character-selection": {
      const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
        event.preventDefault();
        dispatch({ type: "CONTINUE_CHARACTER" });
      };
      workflow = (
        <section className="workflow-card" aria-labelledby="character-title">
          <p className="eyebrow">Choose character</p>
          <h2 id="character-title" ref={headingRef} tabIndex={-1}>
            Which character do you want to analyze?
          </h2>
          <p>Every player character found in the file is listed below.</p>
          <form onSubmit={submit}>
            <fieldset className="choice-list">
              <legend className="sr-only">Detected player characters</legend>
              {state.discovery.players.map((player) => (
                <label key={player.guid}>
                  <input
                    type="radio"
                    name="character"
                    value={player.guid}
                    checked={state.selectedPlayerGuid === player.guid}
                    onChange={() => {
                      dispatch({
                        type: "SELECT_CHARACTER",
                        playerGuid: player.guid,
                      });
                    }}
                  />
                  <span>{player.name ?? "Unnamed character"}</span>
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              disabled={state.selectedPlayerGuid === undefined}
            >
              Continue to sessions
            </button>
          </form>
          <WarningList warnings={state.discoveryWarnings} />
        </section>
      );
      break;
    }
    case "session-selection": {
      const selected = state.discovery.sessions.find(
        (session) =>
          session.id === state.selectedSessionId &&
          session.playerGuid === state.playerGuid,
      );
      workflow = (
        <section
          className="workflow-card wide"
          aria-labelledby="sessions-title"
        >
          <p className="eyebrow">Choose attempt</p>
          <h2 id="sessions-title" ref={headingRef} tabIndex={-1}>
            Training sessions for{" "}
            {playerName(state.discovery, state.playerGuid)}
          </h2>
          {state.notice === undefined ? null : (
            <p className="notice" role="status">
              {state.notice}
            </p>
          )}
          <SessionGroups
            state={state}
            onSelect={(sessionId) => {
              dispatch({ type: "SELECT_SESSION", sessionId });
            }}
          />
          <div className="button-row sticky-actions">
            <button
              type="button"
              disabled={selected === undefined}
              onClick={() => {
                if (selected !== undefined)
                  startProcessing(state.file, selected);
              }}
            >
              Process selected attempt
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                dispatch({ type: "CHANGE_CHARACTER" });
              }}
            >
              Choose another character
            </button>
          </div>
        </section>
      );
      break;
    }
    case "processing":
      workflow = (
        <section className="workflow-card" aria-labelledby="process-title">
          <p className="eyebrow">Detailed processing</p>
          <h2 id="process-title" ref={headingRef} tabIndex={-1}>
            Building your clean training session
          </h2>
          <p>
            Reading the selected time window, resolving controlled entities, and
            removing unrelated nearby activity.
          </p>
          <ProgressView
            progress={state.progress}
            totalBytes={state.file.size}
          />
          <button type="button" className="secondary-button" onClick={cancel}>
            Cancel processing
          </button>
        </section>
      );
      break;
    case "result":
      workflow = (
        <section className="workflow-card wide" aria-labelledby="result-title">
          <p className="eyebrow">Session ready</p>
          <h2 id="result-title" ref={headingRef} tabIndex={-1}>
            Your clean training session
          </h2>
          <Summary state={state} onExport={exportSession} />
          <div className="button-row workflow-navigation">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                dispatch({ type: "RETURN_TO_SESSIONS" });
              }}
            >
              Select another session
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                dispatch({ type: "CHANGE_CHARACTER" });
              }}
            >
              Choose another character
            </button>
          </div>
        </section>
      );
      break;
    case "error":
      workflow = (
        <section
          className="workflow-card error-panel"
          aria-labelledby="error-title"
        >
          <p className="eyebrow">We couldn't finish</p>
          <h2 id="error-title" ref={headingRef} tabIndex={-1}>
            {state.error.category === "invalid-combat-log"
              ? "This doesn't look like a supported WoW combat log"
              : state.error.category === "file-unreadable"
                ? "The file couldn't be read"
                : state.error.category === "unsupported-log-format"
                  ? "This combat-log format isn't supported yet"
                  : state.error.category === "no-player-characters"
                    ? "No player characters were found"
                    : state.error.category === "session-too-large"
                      ? "This session is too large for the current limit"
                      : "Processing stopped with an error"}
          </h2>
          <ErrorDetails error={state.error} />
          <div className="button-row">
            {state.source === "discovery" ? (
              <button
                type="button"
                onClick={() => {
                  startDiscovery(state.file);
                }}
              >
                Try this file again
              </button>
            ) : state.candidate === undefined ? null : (
              <button
                type="button"
                onClick={() => {
                  const candidate = state.candidate;
                  if (candidate !== undefined) {
                    startProcessing(state.file, candidate);
                  }
                }}
              >
                Retry processing
              </button>
            )}
            {state.source === "processing" ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  dispatch({ type: "RETURN_TO_SESSIONS" });
                }}
              >
                Back to sessions
              </button>
            ) : null}
          </div>
        </section>
      );
      break;
    case "cancelled":
      workflow = (
        <section className="workflow-card" aria-labelledby="cancelled-title">
          <p className="eyebrow">Cancelled</p>
          <h2 id="cancelled-title" ref={headingRef} tabIndex={-1}>
            {state.stage === "discovery"
              ? "File scanning was cancelled"
              : "Session processing was cancelled"}
          </h2>
          <p>No partial or late result will replace this screen.</p>
          <div className="button-row">
            {state.stage === "discovery" ? (
              <button
                type="button"
                onClick={() => {
                  startDiscovery(state.file);
                }}
              >
                Scan this file again
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  dispatch({
                    type: "RETURN_TO_SESSIONS",
                    notice:
                      "Processing was cancelled. Choose an attempt when you are ready.",
                  });
                }}
              >
                Back to sessions
              </button>
            )}
          </div>
        </section>
      );
      break;
  }

  return (
    <div className="page-shell">
      <header className="site-header">
        <a
          className="brand"
          href="./"
          aria-label="WoW Training Dummy Log Analyzer home"
        >
          Combat Lab
        </a>
        <span className="status-badge">Browser only</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">WoW Retail · Training dummies</p>
          <h1 id="page-title">
            Find the clean attempt inside your combat log.
          </h1>
          <p className="lede">
            Choose a file, confirm your character, then select the training
            session you want to review and export.
          </p>
        </section>

        <aside className="privacy-card" aria-labelledby="privacy-title">
          <span className="privacy-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2 id="privacy-title">Your combat log stays on your computer.</h2>
            <p>
              This file is processed locally in your browser and is never
              uploaded.
            </p>
          </div>
        </aside>

        <input
          ref={inputRef}
          id="combat-log-file"
          className="sr-only"
          type="file"
          aria-label="Choose a WoW combat log file"
          onChange={(event) => {
            receiveFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        {currentFile === undefined ? null : (
          <div className="file-toolbar" aria-label="Current file">
            <span>
              {currentFile.name} · {formatBytes(currentFile.size)}
            </span>
            <button type="button" className="text-button" onClick={chooseFile}>
              Choose another file
            </button>
          </div>
        )}

        <div className="workflow-region">{workflow}</div>
      </main>

      <footer>
        <p>No account · No analytics · No server</p>
      </footer>
    </div>
  );
}
