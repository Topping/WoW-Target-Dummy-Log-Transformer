import {
  serializeFilteredSessionLog,
  serializeSessionJson,
  sessionExportFilename,
  type OperationResult,
  type Session,
  type SessionExportKind,
  type SessionExportOptions,
} from "../core";

export interface BrowserSessionDownload {
  readonly blob: Blob;
  readonly filename: string;
}

export function createSessionDownload(
  session: Session,
  kind: SessionExportKind,
  options: SessionExportOptions = {},
): OperationResult<BrowserSessionDownload> {
  const serialized =
    kind === "json"
      ? serializeSessionJson(session, options)
      : serializeFilteredSessionLog(session, options);
  if (!serialized.ok) return serialized;
  return {
    ok: true,
    value: {
      blob: new Blob([serialized.value.content], {
        type: serialized.value.mediaType,
      }),
      filename: sessionExportFilename(session, kind),
    },
    warnings: serialized.warnings,
  };
}
