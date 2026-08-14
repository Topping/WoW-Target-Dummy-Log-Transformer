import type {
  AppError,
  DiscoveryResult,
  ParserWarning,
  ProcessingProgress,
  Session,
  SessionCandidate,
  SessionExportKind,
} from "../core";

interface DiscoveryContext {
  readonly file: File;
  readonly discovery: DiscoveryResult;
  readonly discoveryWarnings: readonly ParserWarning[];
}

interface CharacterContext extends DiscoveryContext {
  readonly playerGuid: string;
}

export interface ExportFeedback {
  readonly kind: SessionExportKind;
  readonly outcome: "success" | "error";
  readonly message: string;
  readonly warnings: readonly ParserWarning[];
  readonly error?: AppError;
}

export type AnalyzerState =
  | { readonly status: "waiting" }
  | {
      readonly status: "discovering";
      readonly file: File;
      readonly operationId: string;
      readonly progress?: ProcessingProgress;
    }
  | (DiscoveryContext & {
      readonly status: "character-selection";
      readonly selectedPlayerGuid?: string;
    })
  | (CharacterContext & {
      readonly status: "session-selection";
      readonly notice?: string;
    })
  | (CharacterContext & {
      readonly status: "processing";
      readonly candidate: SessionCandidate;
      readonly operationId: string;
      readonly progress?: ProcessingProgress;
    })
  | (CharacterContext & {
      readonly status: "result";
      readonly candidate: SessionCandidate;
      readonly session: Session;
      readonly exportFeedback?: ExportFeedback;
    })
  | {
      readonly status: "error";
      readonly source: "discovery" | "processing";
      readonly error: AppError;
      readonly file: File;
      readonly discovery?: DiscoveryResult;
      readonly discoveryWarnings?: readonly ParserWarning[];
      readonly playerGuid?: string;
      readonly candidate?: SessionCandidate;
    }
  | {
      readonly status: "cancelled";
      readonly stage: "discovery" | "processing";
      readonly file: File;
      readonly discovery?: DiscoveryResult;
      readonly discoveryWarnings?: readonly ParserWarning[];
      readonly playerGuid?: string;
      readonly candidate?: SessionCandidate;
    };

export type AnalyzerAction =
  | {
      readonly type: "START_DISCOVERY";
      readonly file: File;
      readonly operationId: string;
    }
  | {
      readonly type: "DISCOVERY_PROGRESS";
      readonly operationId: string;
      readonly progress: ProcessingProgress;
    }
  | {
      readonly type: "DISCOVERY_SUCCEEDED";
      readonly operationId: string;
      readonly discovery: DiscoveryResult;
      readonly warnings: readonly ParserWarning[];
    }
  | {
      readonly type: "DISCOVERY_FAILED";
      readonly operationId: string;
      readonly error: AppError;
    }
  | { readonly type: "CHANGE_CHARACTER" }
  | { readonly type: "SELECT_CHARACTER"; readonly playerGuid: string }
  | { readonly type: "CONTINUE_CHARACTER" }
  | {
      readonly type: "START_PROCESSING";
      readonly candidate: SessionCandidate;
      readonly operationId: string;
    }
  | {
      readonly type: "PROCESS_PROGRESS";
      readonly operationId: string;
      readonly progress: ProcessingProgress;
    }
  | {
      readonly type: "PROCESS_SUCCEEDED";
      readonly operationId: string;
      readonly session: Session;
    }
  | {
      readonly type: "PROCESS_FAILED";
      readonly operationId: string;
      readonly error: AppError;
    }
  | { readonly type: "CANCEL_OPERATION"; readonly operationId: string }
  | { readonly type: "RETURN_TO_SESSIONS"; readonly notice?: string }
  | {
      readonly type: "EXPORT_SUCCEEDED";
      readonly kind: SessionExportKind;
      readonly filename: string;
      readonly warnings: readonly ParserWarning[];
    }
  | {
      readonly type: "EXPORT_FAILED";
      readonly kind: SessionExportKind;
      readonly error: AppError;
    }
  | { readonly type: "RESET" };

export const initialAnalyzerState: AnalyzerState = { status: "waiting" };

function noPlayersError(): AppError {
  return {
    category: "no-player-characters",
    code: "NO_PLAYER_CHARACTERS",
    message: "We couldn't find a player character in this combat log.",
    recoverable: true,
    suggestedAction:
      "Make sure combat logging was enabled while your character was active, then choose the log again.",
  };
}

function toSessionSelection(
  state: DiscoveryContext,
  playerGuid: string,
  notice?: string,
): AnalyzerState {
  return {
    status: "session-selection",
    file: state.file,
    discovery: state.discovery,
    discoveryWarnings: state.discoveryWarnings,
    playerGuid,
    ...(notice === undefined ? {} : { notice }),
  };
}

export function analyzerReducer(
  state: AnalyzerState,
  action: AnalyzerAction,
): AnalyzerState {
  if (action.type === "START_DISCOVERY") {
    return {
      status: "discovering",
      file: action.file,
      operationId: action.operationId,
    };
  }
  if (action.type === "RESET") return initialAnalyzerState;

  switch (state.status) {
    case "waiting":
      return state;
    case "discovering": {
      if ("operationId" in action && action.operationId !== state.operationId) {
        return state;
      }
      if (action.type === "DISCOVERY_PROGRESS") {
        return { ...state, progress: action.progress };
      }
      if (action.type === "DISCOVERY_FAILED") {
        return {
          status: "error",
          source: "discovery",
          error: action.error,
          file: state.file,
        };
      }
      if (action.type === "DISCOVERY_SUCCEEDED") {
        if (action.discovery.players.length === 0) {
          return {
            status: "error",
            source: "discovery",
            error: noPlayersError(),
            file: state.file,
          };
        }
        const context = {
          file: state.file,
          discovery: action.discovery,
          discoveryWarnings: action.warnings,
        };
        const proposed = action.discovery.proposedRecorderGuid;
        if (
          proposed !== undefined &&
          action.discovery.players.some((player) => player.guid === proposed)
        ) {
          return toSessionSelection(context, proposed);
        }
        return { status: "character-selection", ...context };
      }
      if (action.type === "CANCEL_OPERATION") {
        return {
          status: "cancelled",
          stage: "discovery",
          file: state.file,
        };
      }
      return state;
    }
    case "character-selection":
      if (action.type === "SELECT_CHARACTER") {
        if (
          !state.discovery.players.some(
            (player) => player.guid === action.playerGuid,
          )
        ) {
          return state;
        }
        return { ...state, selectedPlayerGuid: action.playerGuid };
      }
      if (
        action.type === "CONTINUE_CHARACTER" &&
        state.selectedPlayerGuid !== undefined
      ) {
        return toSessionSelection(state, state.selectedPlayerGuid);
      }
      return state;
    case "session-selection":
      if (action.type === "CHANGE_CHARACTER") {
        return {
          status: "character-selection",
          file: state.file,
          discovery: state.discovery,
          discoveryWarnings: state.discoveryWarnings,
          selectedPlayerGuid: state.playerGuid,
        };
      }
      if (action.type === "START_PROCESSING") {
        const valid =
          action.candidate.playerGuid === state.playerGuid &&
          state.discovery.sessions.some(
            (session) => session.id === action.candidate.id,
          );
        if (!valid) return state;
        return {
          status: "processing",
          file: state.file,
          discovery: state.discovery,
          discoveryWarnings: state.discoveryWarnings,
          playerGuid: state.playerGuid,
          candidate: action.candidate,
          operationId: action.operationId,
        };
      }
      return state;
    case "processing": {
      if ("operationId" in action && action.operationId !== state.operationId) {
        return state;
      }
      if (action.type === "PROCESS_PROGRESS") {
        return { ...state, progress: action.progress };
      }
      if (action.type === "PROCESS_SUCCEEDED") {
        return {
          status: "result",
          file: state.file,
          discovery: state.discovery,
          discoveryWarnings: state.discoveryWarnings,
          playerGuid: state.playerGuid,
          candidate: state.candidate,
          session: action.session,
        };
      }
      if (action.type === "PROCESS_FAILED") {
        return {
          status: "error",
          source: "processing",
          error: action.error,
          file: state.file,
          discovery: state.discovery,
          discoveryWarnings: state.discoveryWarnings,
          playerGuid: state.playerGuid,
          candidate: state.candidate,
        };
      }
      if (action.type === "CANCEL_OPERATION") {
        return {
          status: "cancelled",
          stage: "processing",
          file: state.file,
          discovery: state.discovery,
          discoveryWarnings: state.discoveryWarnings,
          playerGuid: state.playerGuid,
          candidate: state.candidate,
        };
      }
      return state;
    }
    case "result":
      if (action.type === "RETURN_TO_SESSIONS") {
        return toSessionSelection(state, state.playerGuid, action.notice);
      }
      if (action.type === "CHANGE_CHARACTER") {
        return {
          status: "character-selection",
          file: state.file,
          discovery: state.discovery,
          discoveryWarnings: state.discoveryWarnings,
          selectedPlayerGuid: state.playerGuid,
        };
      }
      if (action.type === "EXPORT_SUCCEEDED") {
        return {
          ...state,
          exportFeedback: {
            kind: action.kind,
            outcome: "success",
            message: `${action.filename} is ready in your downloads. Character metadata came from the pasted SimulationCraft profile.`,
            warnings: action.warnings,
          },
        };
      }
      if (action.type === "EXPORT_FAILED") {
        return {
          ...state,
          exportFeedback: {
            kind: action.kind,
            outcome: "error",
            message: action.error.message,
            warnings: [],
            error: action.error,
          },
        };
      }
      return state;
    case "error":
      if (
        action.type === "RETURN_TO_SESSIONS" &&
        state.source === "processing" &&
        state.discovery !== undefined &&
        state.discoveryWarnings !== undefined &&
        state.playerGuid !== undefined
      ) {
        return toSessionSelection(
          {
            file: state.file,
            discovery: state.discovery,
            discoveryWarnings: state.discoveryWarnings,
          },
          state.playerGuid,
          action.notice,
        );
      }
      if (
        action.type === "START_PROCESSING" &&
        state.source === "processing" &&
        state.discovery !== undefined &&
        state.discoveryWarnings !== undefined &&
        state.playerGuid !== undefined
      ) {
        return {
          status: "processing",
          file: state.file,
          discovery: state.discovery,
          discoveryWarnings: state.discoveryWarnings,
          playerGuid: state.playerGuid,
          candidate: action.candidate,
          operationId: action.operationId,
        };
      }
      return state;
    case "cancelled":
      if (
        action.type === "RETURN_TO_SESSIONS" &&
        state.stage === "processing" &&
        state.discovery !== undefined &&
        state.discoveryWarnings !== undefined &&
        state.playerGuid !== undefined
      ) {
        return toSessionSelection(
          {
            file: state.file,
            discovery: state.discovery,
            discoveryWarnings: state.discoveryWarnings,
          },
          state.playerGuid,
          action.notice,
        );
      }
      return state;
  }
}
