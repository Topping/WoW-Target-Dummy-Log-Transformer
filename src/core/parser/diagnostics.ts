import type { AppError, ParserWarning, SourceLocation } from "../contracts";

export function parserFailure(
  code: string,
  message: string,
  location?: SourceLocation,
  rawLine?: string,
  details?: Readonly<Record<string, unknown>>,
): AppError {
  const technicalDetails =
    location === undefined && rawLine === undefined && details === undefined
      ? undefined
      : {
          ...(location === undefined ? {} : { location }),
          ...(rawLine === undefined ? {} : { rawLine }),
          ...(details === undefined ? {} : { details }),
        };

  return {
    category: "unsupported-log-format",
    code,
    message,
    recoverable: true,
    suggestedAction:
      "Keep the original log and report the technical details so this format can be supported.",
    ...(technicalDetails === undefined ? {} : { technicalDetails }),
  };
}

export function parserWarning(
  code: string,
  message: string,
  options: {
    readonly location?: SourceLocation;
    readonly eventType?: string;
    readonly schemaId?: string;
    readonly rawLine?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  } = {},
): ParserWarning {
  const hasContext = Object.keys(options).length > 0;
  return {
    code,
    severity: "warning",
    message,
    ...(hasContext ? { context: options } : {}),
  };
}
