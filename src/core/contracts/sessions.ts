import type { Actor } from "./actors";
import type { NonEmptyReadonlyArray, RawTimestamp } from "./common";
import type { ParserWarning } from "./diagnostics";
import type { CombatEvent } from "./events";
import type { ParserMetadata } from "./parser";

export interface SessionSelection {
  readonly id: string;
  readonly playerGuid: string;
  readonly targetGuids: NonEmptyReadonlyArray<string>;
  readonly startTime: RawTimestamp;
  readonly endTime: RawTimestamp;
}

export interface SessionExtractionBudgets {
  readonly softRetainedEventLimit?: number;
  readonly hardRetainedEventLimit?: number;
  readonly softEstimatedByteLimit?: number;
  readonly hardEstimatedByteLimit?: number;
}

export type SessionExtractionWarningCode =
  | "OWNERSHIP_CONFLICT"
  | "SESSION_SOFT_EVENT_LIMIT_EXCEEDED"
  | "SESSION_SOFT_BYTE_LIMIT_EXCEEDED";

export type SessionExtractionFailureCode =
  "SESSION_HARD_EVENT_LIMIT_EXCEEDED" | "SESSION_HARD_BYTE_LIMIT_EXCEEDED";

export interface SessionExtractionOptions {
  /** State-reconstruction time before the visible selection. Defaults to 5 seconds. */
  readonly preRollMs?: number;
  /** State-reconstruction time after the visible selection. Defaults to 5 seconds. */
  readonly postRollMs?: number;
  readonly budgets?: SessionExtractionBudgets;
  readonly includeDebugDecisions?: boolean;
}

export type FilteringKeepReason =
  | "primary-outgoing"
  | "owned-entity-outgoing"
  | "primary-incoming"
  | "owned-entity-incoming"
  | "selected-target-metadata"
  | "required-metadata";

export type FilteringRemoveReason =
  | "unrelated-player-activity"
  | "unrelated-creature-activity"
  | "unrelated-record";

export interface FilteringAudit {
  readonly consideredRecordCount: number;
  readonly keptRecordCount: number;
  readonly removedRecordCount: number;
  readonly keptByReason: Readonly<Record<FilteringKeepReason, number>>;
  readonly removedByReason: Readonly<Record<FilteringRemoveReason, number>>;
  readonly skippedBeforePreRollCount: number;
  readonly stoppedAfterPostRoll: boolean;
  readonly bytesRead: number;
  readonly estimatedRetainedBytes: number;
}

export interface FilteringDebugDecision {
  readonly lineNumber: number;
  readonly timestamp: RawTimestamp;
  readonly relativeTimeTicks: bigint;
  readonly eventType: string;
  readonly decision: "kept" | "removed";
  readonly reason: FilteringKeepReason | FilteringRemoveReason;
  readonly sourceGuid?: string;
  readonly destinationGuid?: string;
}

export interface SessionTargetStatistics {
  readonly targetGuid: string;
  readonly relevantEventCount: number;
  readonly outgoingEventCount: number;
  readonly incomingEventCount: number;
  readonly damageEventCount: number;
  readonly observedDamageAmount: number;
}

export interface SessionStatistics {
  readonly relevantEventCount: number;
  readonly removedEventCount: number;
  readonly controlledEntityCount: number;
  readonly externalEffectCount: number;
  readonly unknownEventTypeCount: number;
  readonly targets: NonEmptyReadonlyArray<SessionTargetStatistics>;
  readonly filtering: FilteringAudit;
}

export interface Session {
  readonly id: string;
  readonly parser: ParserMetadata;
  readonly startTime: RawTimestamp;
  readonly endTime: RawTimestamp;
  readonly durationTicks: bigint;
  readonly player: Actor;
  /** Every affected target in the selected activity window. Never empty. */
  readonly targets: NonEmptyReadonlyArray<Actor>;
  /** Optional inferred focus; multi-target sessions do not require one. */
  readonly focusTargetGuid?: string;
  readonly actors: readonly Actor[];
  readonly events: readonly CombatEvent[];
  readonly warnings: readonly ParserWarning[];
  readonly statistics: SessionStatistics;
  readonly debugDecisions?: readonly FilteringDebugDecision[];
}
