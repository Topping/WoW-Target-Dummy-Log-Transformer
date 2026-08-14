export type SessionExportKind = "json" | "encounter-log";

export type SessionExportWarningCode =
  "EXPORT_SOFT_BYTE_LIMIT_EXCEEDED" | "WOWCOACH_COMPATIBILITY_TEMPLATE_USED";
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
