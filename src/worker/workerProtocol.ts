import type {
  AppError,
  DiscoveryResult,
  ParserWarning,
  ProcessingProgress,
  Session,
  SessionSelection,
} from "../core";

export type WorkerRequest =
  | {
      readonly type: "DISCOVER_FILE";
      readonly operationId: string;
      readonly file: File;
    }
  | {
      readonly type: "PROCESS_SESSION";
      readonly operationId: string;
      readonly file: File;
      readonly selection: SessionSelection;
    }
  | {
      readonly type: "CANCEL";
      readonly operationId: string;
    };

export type WorkerResponse =
  | {
      readonly type: "PROGRESS";
      readonly progress: ProcessingProgress;
    }
  | {
      readonly type: "DISCOVERY_COMPLETE";
      readonly operationId: string;
      readonly result: DiscoveryResult;
      readonly warnings: readonly ParserWarning[];
    }
  | {
      readonly type: "SESSION_COMPLETE";
      readonly operationId: string;
      readonly session: Session;
    }
  | {
      readonly type: "ERROR";
      readonly operationId: string;
      readonly error: AppError;
    };
