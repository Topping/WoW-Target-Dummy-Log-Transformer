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
  BuildSimcCombatantInfoOptions,
  BuiltCombatantInfo,
  DiscoveryResult,
  OperationResult,
  ParserWarning,
  ProcessingProgress,
  Session,
  SessionCandidate,
  SessionExportKind,
  SessionSelection,
} from "../core";
import { buildSimcCombatantInfo } from "../core";
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
    options?: { readonly combatantInfo?: BuiltCombatantInfo },
  ) => OperationResult<SavedSessionDownload>;
  readonly buildCharacterProfile?: (
    player: Pick<Session["player"], "guid" | "name">,
    schemaId: string,
    text: string,
    options?: BuildSimcCombatantInfoOptions,
  ) => OperationResult<BuiltCombatantInfo>;
}

interface CharacterProfileState {
  readonly built: BuiltCombatantInfo;
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
  const announcedPercentage =
    percentage === 100 ? 100 : Math.floor(percentage / 10) * 10;
  return (
    <div className="progress-panel">
      <progress
        aria-label="Combat log processing progress"
        max={total || 1}
        value={processed}
      >
        {String(percentage)}%
      </progress>
      <p className="progress-copy">{percentage}%</p>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {progress === undefined
          ? "Processing is starting."
          : `${phaseLabel(progress.phase)}, ${String(announcedPercentage)} percent.`}
      </p>
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
    <section
      className="warning-panel"
      aria-labelledby="warnings-title"
      role="status"
    >
      <h3 id="warnings-title">Things to check</h3>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${String(index)}`}>{warning.message}</li>
        ))}
      </ul>
      <details>
        <summary>Show warning details</summary>
        <pre tabIndex={0}>{stringifyTechnicalDetails(warnings)}</pre>
      </details>
    </section>
  );
}

function SessionCard({
  candidate,
  discovery,
  onChoose,
}: {
  readonly candidate: SessionCandidate;
  readonly discovery: DiscoveryResult;
  readonly onChoose: () => void;
}) {
  return (
    <article className="session-card">
      <div className="session-card-body">
        <div className="session-heading">
          <strong>
            {candidate.confidence === "likely"
              ? "Recommended attempt"
              : candidate.confidence === "possible"
                ? "Possible attempt"
                : "Brief interaction"}
          </strong>
          <span>{formatDuration(candidate.durationTicks)}</span>
        </div>
        <p className="time-range">
          {formatVisibleTime(candidate.startTime)} ·{" "}
          {candidate.targetGuids.length === 1
            ? targetName(discovery, candidate.targetGuids[0])
            : `${String(candidate.targetGuids.length)} targets`}
        </p>
        <div className="session-card-actions">
          <button type="button" onClick={onChoose}>
            Use this attempt
          </button>
        </div>
        <details>
          <summary>Why this attempt?</summary>
          <ul>
            {candidate.reasons.map((reason) => (
              <li key={reason.code}>{reason.description}</li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}

function SessionGroups({
  state,
  onChoose,
}: {
  readonly state: Extract<AnalyzerState, { status: "session-selection" }>;
  readonly onChoose: (candidate: SessionCandidate) => void;
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
            <summary>Brief interactions</summary>
            {incidental.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                onChoose={() => {
                  onChoose(candidate);
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
          <h3 id="likely-title">Recommended</h3>
          <div className="card-stack">
            {likely.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                onChoose={() => {
                  onChoose(candidate);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {possible.length > 0 ? (
        <section aria-labelledby="possible-title">
          <h3 id="possible-title">Other attempts</h3>
          <div className="card-stack">
            {possible.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                onChoose={() => {
                  onChoose(candidate);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {incidental.length > 0 ? (
        <details className="advanced-panel">
          <summary>Brief interactions</summary>
          <div className="card-stack">
            {incidental.map((candidate) => (
              <SessionCard
                key={candidate.id}
                candidate={candidate}
                discovery={state.discovery}
                onChoose={() => {
                  onChoose(candidate);
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
          <pre tabIndex={0}>
            {stringifyTechnicalDetails(error.technicalDetails)}
          </pre>
        </details>
      )}
    </>
  );
}

function Summary({
  state,
  onExport,
  characterProfile,
  profileDraft,
  profileError,
  profileFaction,
  needsFaction,
  onProfileDraftChange,
  onProfileFactionChange,
  onUseProfile,
  onRemoveProfile,
}: {
  readonly state: Extract<AnalyzerState, { status: "result" }>;
  readonly onExport: (kind: SessionExportKind) => void;
  readonly characterProfile: CharacterProfileState | undefined;
  readonly profileDraft: string;
  readonly profileError: AppError | undefined;
  readonly profileFaction: "alliance" | "horde" | undefined;
  readonly needsFaction: boolean;
  readonly onProfileDraftChange: (value: string) => void;
  readonly onProfileFactionChange: (value: "alliance" | "horde") => void;
  readonly onUseProfile: () => boolean;
  readonly onRemoveProfile: () => void;
}) {
  const { session } = state;
  const profilePanelRef = useRef<HTMLDetailsElement>(null);
  const profileSummaryRef = useRef<HTMLElement>(null);
  const profileErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    profileErrorRef.current?.focus();
  }, [profileError]);
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
    statistics: session.statistics,
    warnings: allWarnings,
    debugDecisions: session.debugDecisions,
  };
  return (
    <div className="result-summary">
      <details ref={profilePanelRef} className="character-profile-panel">
        <summary ref={profileSummaryRef}>
          <span>Character profile</span>
          {characterProfile === undefined ? (
            <span className="character-profile-summary-guide">
              Required: paste your SimulationCraft addon output
            </span>
          ) : (
            <span className="character-profile-active-badge">
              Active profile · {characterProfile.built.profile.characterName}
            </span>
          )}
        </summary>
        <div className="character-profile-body">
          <p>
            Install the SimulationCraft addon before recording your log. In WoW,
            log in to the character you recorded, enter <code>/simc</code>, copy
            all of the addon's output, and paste it below. It supplies character
            metadata only; every combat event still comes from this combat log.
          </p>
          {characterProfile === undefined ? null : (
            <div className="profile-accepted" role="status">
              <p>
                Using {characterProfile.built.profile.characterName} ·{" "}
                {characterProfile.built.profile.class.replaceAll("_", " ")} ·{" "}
                {characterProfile.built.profile.spec.replaceAll("_", " ")} ·{" "}
                {String(characterProfile.built.profile.equipment.length)}{" "}
                equipped items
              </p>
              <button
                type="button"
                className="link-button"
                onClick={onRemoveProfile}
              >
                Remove profile
              </button>
            </div>
          )}
          <form
            className="character-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (onUseProfile()) {
                if (profilePanelRef.current !== null) {
                  profilePanelRef.current.open = false;
                }
                profileSummaryRef.current?.focus();
              }
            }}
          >
            <label htmlFor="simc-profile">SimulationCraft addon output</label>
            <textarea
              id="simc-profile"
              rows={8}
              value={profileDraft}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                onProfileDraftChange(event.currentTarget.value);
              }}
            />
            {needsFaction ? (
              <fieldset className="profile-faction">
                <legend>Character faction</legend>
                {(["alliance", "horde"] as const).map((faction) => (
                  <label key={faction}>
                    <input
                      type="radio"
                      name="profile-faction"
                      checked={profileFaction === faction}
                      onChange={() => {
                        onProfileFactionChange(faction);
                      }}
                    />{" "}
                    {faction === "alliance" ? "Alliance" : "Horde"}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {profileError === undefined ? null : (
              <div
                ref={profileErrorRef}
                className="profile-error error-copy"
                role="alert"
                tabIndex={-1}
              >
                <ErrorDetails error={profileError} />
              </div>
            )}
            <div className="button-row">
              <button
                type="submit"
                className="secondary-button"
                disabled={profileDraft.trim().length === 0}
              >
                {characterProfile === undefined
                  ? "Use profile"
                  : "Replace profile"}
              </button>
            </div>
          </form>
          {characterProfile === undefined ? (
            <p className="muted">
              A validated profile matching the selected character is required
              before download.
            </p>
          ) : null}
        </div>
      </details>
      <section className="result-hero" aria-labelledby="download-title">
        <div>
          <p className="recommended-label">
            {characterProfile === undefined
              ? "Character profile required"
              : "Ready to upload"}
          </p>
          <h3 id="download-title">
            {session.player.name ?? "Unnamed character"}
          </h3>
          <p className="result-meta">
            {formatDuration(session.durationTicks)} ·{" "}
            {session.targets.length === 1
              ? (session.targets[0].name ?? "1 target")
              : `${String(session.targets.length)} targets`}
          </p>
        </div>
        <div className="result-actions">
          <button
            type="button"
            disabled={characterProfile === undefined}
            onClick={() => {
              onExport("encounter-log");
            }}
          >
            Download encounter log
          </button>
          <p>
            {characterProfile === undefined
              ? "Add a validated SimulationCraft profile above to enable download."
              : "Formatted for tools that analyze encounter logs."}
          </p>
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
            {state.exportFeedback.error?.suggestedAction ===
            undefined ? null : (
              <p>{state.exportFeedback.error.suggestedAction}</p>
            )}
          </div>
        )}
      </section>

      <WarningList warnings={allWarnings} />

      <details className="session-details">
        <summary>View attempt details</summary>
        <div className="summary-layout">
          <section className="summary-card" aria-labelledby="overview-title">
            <h3 id="overview-title">Attempt</h3>
            <dl className="summary-list">
              <div>
                <dt>Started</dt>
                <dd>{formatVisibleTime(session.startTime)}</dd>
              </div>
              <div>
                <dt>Duration</dt>
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
            </dl>
          </section>

          <section className="summary-card" aria-labelledby="targets-title">
            <h3 id="targets-title">
              {session.targets.length === 1
                ? "Target"
                : `${String(session.targets.length)} targets`}
            </h3>
            {focus === undefined ? null : (
              <p className="focus-target">
                Focus: {focus.name ?? "Unnamed target"}
              </p>
            )}
            <div className="target-stat-grid">
              {session.statistics.targets.map((statistics) => {
                const target = session.targets.find(
                  (candidate) => candidate.guid === statistics.targetGuid,
                );
                return (
                  <article key={statistics.targetGuid}>
                    <h4>{target?.name ?? "Unnamed target"}</h4>
                    <dl>
                      <div>
                        <dt>Events</dt>
                        <dd>{formatCount(statistics.relevantEventCount)}</dd>
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

          {controlled.length === 0 ? null : (
            <section className="summary-card" aria-labelledby="entities-title">
              <h3 id="entities-title">Pets and controlled entities</h3>
              <ul>
                {controlled.map((actor) => (
                  <li key={actor.guid}>
                    {actor.name ?? "Unnamed controlled entity"}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="technical-panel">
            <summary>Technical details</summary>
            <pre tabIndex={0}>{stringifyTechnicalDetails(technical)}</pre>
          </details>
        </div>
      </details>
    </div>
  );
}

export function App({
  createWorkerClient = createParserWorkerClient,
  downloadSession = saveSessionDownload,
  buildCharacterProfile = buildSimcCombatantInfo,
}: AppProps) {
  const [state, dispatch] = useReducer(analyzerReducer, initialAnalyzerState);
  const [dragActive, setDragActive] = useState(false);
  const [characterProfiles, setCharacterProfiles] = useState<
    ReadonlyMap<string, CharacterProfileState>
  >(new Map());
  const [profileDraft, setProfileDraft] = useState("");
  const [profileError, setProfileError] = useState<AppError>();
  const [profileFaction, setProfileFaction] = useState<"alliance" | "horde">();
  const [needsFaction, setNeedsFaction] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clientRef = useRef<AnalyzerWorkerClient | undefined>(undefined);
  const operationNumber = useRef(0);
  const automaticallyProcessed = useRef(new Set<string>());
  const profilePlayerGuid = useRef<string | undefined>(undefined);

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

  useEffect(() => {
    if (state.status !== "result") return;
    if (profilePlayerGuid.current !== state.playerGuid) {
      setProfileDraft("");
      setProfileError(undefined);
      setProfileFaction(undefined);
      setNeedsFaction(false);
    }
    profilePlayerGuid.current = state.playerGuid;
  }, [state]);

  const nextOperationId = useCallback((): string => {
    operationNumber.current += 1;
    return `ui-operation-${String(operationNumber.current)}`;
  }, []);

  const startDiscovery = useCallback(
    (file: File): void => {
      automaticallyProcessed.current.clear();
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

  useEffect(() => {
    if (state.status !== "session-selection") return;
    const likely = state.discovery.sessions.filter(
      (candidate) =>
        candidate.playerGuid === state.playerGuid &&
        candidate.confidence === "likely",
    );
    if (likely.length !== 1) return;
    const candidate = likely[0];
    if (
      candidate === undefined ||
      automaticallyProcessed.current.has(candidate.id)
    )
      return;
    automaticallyProcessed.current.add(candidate.id);
    startProcessing(state.file, candidate);
  }, [startProcessing, state]);

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

  const startOver = (): void => {
    if (state.status === "discovering" || state.status === "processing") {
      clientRef.current?.cancel();
    }
    automaticallyProcessed.current.clear();
    setDragActive(false);
    setCharacterProfiles(new Map());
    setProfileDraft("");
    setProfileError(undefined);
    setProfileFaction(undefined);
    setNeedsFaction(false);
    profilePlayerGuid.current = undefined;
    dispatch({ type: "RESET" });
  };

  const exportSession = (kind: SessionExportKind): void => {
    if (state.status !== "result") return;
    try {
      const characterProfile = characterProfiles.get(state.playerGuid);
      if (kind === "encounter-log" && characterProfile === undefined) return;
      const result = downloadSession(state.session, kind, {
        ...(characterProfile === undefined
          ? {}
          : { combatantInfo: characterProfile.built }),
      });
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

  const useCharacterProfile = (): boolean => {
    if (state.status !== "result") return false;
    const result = buildCharacterProfile(
      state.session.player,
      state.session.parser.schema.id,
      profileDraft,
      profileFaction === undefined ? {} : { faction: profileFaction },
    );
    if (!result.ok) {
      setNeedsFaction(result.error.code === "SIMC_FACTION_REQUIRED");
      setProfileError(result.error);
      return false;
    }
    setCharacterProfiles((current) => {
      const next = new Map(current);
      next.set(state.playerGuid, { built: result.value });
      return next;
    });
    setProfileDraft("");
    setProfileError(undefined);
    setProfileFaction(undefined);
    setNeedsFaction(false);
    return true;
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
            ↓
          </div>
          <h2 ref={headingRef} tabIndex={-1}>
            Choose your combat log
          </h2>
          <p>Drop WoWCombatLog.txt here, or choose it from your computer.</p>
          <button type="button" onClick={chooseFile}>
            Choose combat log
          </button>
          <p className="trust-line">
            <span aria-hidden="true">✓</span> Processed locally. Nothing is
            uploaded.
          </p>
        </div>
      );
      break;
    case "discovering":
      workflow = (
        <section className="workflow-card" aria-labelledby="scan-title">
          <h2 id="scan-title" ref={headingRef} tabIndex={-1}>
            Scanning combat log
          </h2>
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
    case "character-selection": {
      const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
        event.preventDefault();
        dispatch({ type: "CONTINUE_CHARACTER" });
      };
      workflow = (
        <section className="workflow-card" aria-labelledby="character-title">
          <h2 id="character-title" ref={headingRef} tabIndex={-1}>
            Choose your character
          </h2>
          <p>We found more than one possible recorder.</p>
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
              Continue
            </button>
          </form>
          <WarningList warnings={state.discoveryWarnings} />
        </section>
      );
      break;
    }
    case "session-selection": {
      workflow = (
        <section
          className="workflow-card wide"
          aria-labelledby="sessions-title"
        >
          <h2 id="sessions-title" ref={headingRef} tabIndex={-1}>
            Choose an attempt
          </h2>
          <div className="inline-context">
            <span>{playerName(state.discovery, state.playerGuid)}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                dispatch({ type: "CHANGE_CHARACTER" });
              }}
            >
              Change character
            </button>
          </div>
          {state.notice === undefined ? null : (
            <p className="notice" role="status">
              {state.notice}
            </p>
          )}
          <SessionGroups
            state={state}
            onChoose={(candidate) => {
              startProcessing(state.file, candidate);
            }}
          />
        </section>
      );
      break;
    }
    case "processing":
      workflow = (
        <section className="workflow-card" aria-labelledby="process-title">
          <h2 id="process-title" ref={headingRef} tabIndex={-1}>
            Preparing encounter log
          </h2>
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
          <h2 id="result-title" ref={headingRef} tabIndex={-1}>
            Your encounter log is ready
          </h2>
          <Summary
            state={state}
            onExport={exportSession}
            characterProfile={characterProfiles.get(state.playerGuid)}
            profileDraft={profileDraft}
            profileError={profileError}
            profileFaction={profileFaction}
            needsFaction={needsFaction}
            onProfileDraftChange={(value) => {
              setProfileDraft(value);
              setProfileError(undefined);
            }}
            onProfileFactionChange={(value) => {
              setProfileFaction(value);
              setProfileError(undefined);
            }}
            onUseProfile={useCharacterProfile}
            onRemoveProfile={() => {
              setCharacterProfiles((current) => {
                const next = new Map(current);
                next.delete(state.playerGuid);
                return next;
              });
              setProfileDraft("");
              setProfileError(undefined);
              setProfileFaction(undefined);
              setNeedsFaction(false);
            }}
          />
          <div className="button-row workflow-navigation">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                dispatch({ type: "RETURN_TO_SESSIONS" });
              }}
            >
              Choose a different attempt
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
          role="alert"
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
      <main
        className={state.status === "waiting" ? "landing-main" : "app-main"}
      >
        {state.status === "waiting" ? (
          <section className="hero" aria-labelledby="page-title">
            <h1 id="page-title">
              Turn a target dummy log into an encounter log.
            </h1>
            <p className="lede">
              Create a simulated encounter from your WoW Retail combat log for
              use with encounter analysis tools.
            </p>
          </section>
        ) : (
          <h1 className="sr-only">Target dummy encounter converter</h1>
        )}

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
            <button type="button" className="text-button" onClick={startOver}>
              Start over
            </button>
          </div>
        )}

        <div className="workflow-region">{workflow}</div>

        {state.status === "waiting" ? (
          <>
            <aside
              className="unlisted-notice"
              aria-labelledby="unlisted-notice-title"
            >
              <div className="unlisted-notice-mark" aria-hidden="true">
                !
              </div>
              <div>
                <h2 id="unlisted-notice-title">
                  Upload to Warcraft Logs as Unlisted
                </h2>
                <p>
                  The generated file is an analysis-only synthetic encounter.
                  Keep the report unlisted so it is available by direct link
                  without entering public rankings. Do not publish it or use it
                  for rankings.
                </p>
              </div>
            </aside>

            <section className="user-guide" aria-labelledby="guide-title">
              <h2 id="guide-title">How to use it</h2>
              <ol>
                <li>Install the SimulationCraft addon before recording.</li>
                <li>Upload your target dummy combat log.</li>
                <li>
                  Paste the complete text output from <code>/simc</code> into{" "}
                  <strong>Character profile</strong>.
                </li>
                <li>
                  Download the transformed <code>.txt</code> file.
                </li>
                <li>
                  Upload that file to Warcraft Logs as <strong>Unlisted</strong>{" "}
                  with the Archon desktop client.
                </li>
                <li>
                  Copy the Warcraft Logs link into your chosen analysis tool.
                </li>
              </ol>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
