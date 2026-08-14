import type { SourceLocation } from "./common";

export type WarningSeverity = "info" | "warning";

export interface DiagnosticContext {
  readonly location?: SourceLocation;
  readonly eventType?: string;
  readonly schemaId?: string;
  readonly rawLine?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ParserWarning {
  readonly code: string;
  readonly severity: WarningSeverity;
  readonly message: string;
  readonly context?: DiagnosticContext;
}

export type AppErrorCategory =
  | "empty-file"
  | "file-unreadable"
  | "invalid-combat-log"
  | "no-player-characters"
  | "no-training-sessions"
  | "unsupported-log-format"
  | "session-too-large"
  | "cancelled"
  | "internal";

export interface AppError {
  readonly category: AppErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly suggestedAction?: string;
  readonly technicalDetails?: DiagnosticContext;
}

export type OperationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly warnings: readonly ParserWarning[];
    }
  | {
      readonly ok: false;
      readonly error: AppError;
      readonly warnings: readonly ParserWarning[];
    };
