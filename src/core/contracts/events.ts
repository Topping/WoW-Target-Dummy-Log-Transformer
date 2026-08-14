import type { ActorReference } from "./actors";
import type { CombatLogOrigin, RawTimestamp, SourceLocation } from "./common";

export interface SpellReference {
  readonly id?: number;
  readonly name?: string;
  readonly school?: string;
}

export interface CombatEvent {
  readonly timestamp: RawTimestamp;
  readonly relativeTimeTicks: bigint;
  readonly type: string;
  readonly source?: ActorReference;
  readonly destination?: ActorReference;
  readonly spell?: SpellReference;
  readonly payload: unknown;
  readonly additionalFields: readonly string[];
  readonly origin: CombatLogOrigin;
  readonly raw: string;
  readonly location: SourceLocation;
}
