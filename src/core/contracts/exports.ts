export type SessionExportKind = "json" | "filtered-log";

export type SessionExportWarningCode = "EXPORT_SOFT_BYTE_LIMIT_EXCEEDED";
export type SessionExportFailureCode = "EXPORT_HARD_BYTE_LIMIT_EXCEEDED";

export interface SessionExportSizeLimits {
  readonly softByteLimit?: number;
  readonly hardByteLimit?: number;
}

export interface SessionExportOptions {
  readonly sizeLimits?: SessionExportSizeLimits;
}

export interface SerializedSessionExport {
  readonly content: string;
  readonly mediaType: string;
  readonly byteLength: number;
}
