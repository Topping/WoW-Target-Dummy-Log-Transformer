import type { RawField, RawTimestamp, SourceLocation } from "./common";
import type { CombatEvent } from "./events";

export type SchemaSelection = "exact" | "fallback" | "manual-override";

export interface CombatLogVersion {
  readonly projectId: number;
  readonly logVersion: number;
  readonly buildVersion: string;
  readonly advancedLoggingEnabled: boolean;
}

export interface SchemaMetadata {
  readonly id: string;
  readonly selection: SchemaSelection;
  readonly detectedVersion?: CombatLogVersion;
}

export interface ParserMetadata {
  readonly parserVersion: string;
  readonly schema: SchemaMetadata;
}

export interface RawCombatLogRecord {
  readonly timestamp: RawTimestamp;
  readonly eventType: string;
  /** Event name followed by every payload field. */
  readonly fields: readonly RawField[];
  readonly raw: string;
  readonly location: SourceLocation;
}

export interface ParsedCombatLog {
  readonly parser: ParserMetadata;
  readonly records: readonly CombatEvent[];
  readonly linesRead: number;
}

export type ProcessingPhase =
  | "opening-file"
  | "validating-file"
  | "scanning-actors"
  | "detecting-attempts"
  | "processing-session"
  | "filtering-events"
  | "building-result";

export interface ProcessingProgress {
  readonly operationId: string;
  readonly phase: ProcessingPhase;
  readonly bytesProcessed: number;
  readonly totalBytes: number;
  readonly status: string;
}
