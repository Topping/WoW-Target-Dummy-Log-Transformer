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

export interface SessionStatistics {
  readonly relevantEventCount: number;
  readonly removedEventCount: number;
  readonly controlledEntityCount: number;
  readonly externalEffectCount: number;
  readonly unknownEventTypeCount: number;
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
}
