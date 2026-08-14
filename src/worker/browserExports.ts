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

export interface SavedSessionDownload {
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

/**
 * Browser-only handoff from an in-memory export to the user's download UI.
 * The temporary object URL is always revoked, including when DOM interaction
 * fails, and the generated anchor is never retained in the document.
 */
export function saveSessionDownload(
  session: Session,
  kind: SessionExportKind,
  options: SessionExportOptions = {},
): OperationResult<SavedSessionDownload> {
  const download = createSessionDownload(session, kind, options);
  if (!download.ok) return download;

  const objectUrl = URL.createObjectURL(download.value.blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = download.value.filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return {
    ok: true,
    value: { filename: download.value.filename },
    warnings: download.warnings,
  };
}
