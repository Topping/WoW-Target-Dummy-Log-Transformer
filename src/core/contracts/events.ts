import type { ActorReference } from "./actors";
import type {
  CombatLogOrigin,
  RawField,
  RawTimestamp,
  SourceLineTerminator,
  SourceLocation,
} from "./common";

export interface SpellReference {
  readonly id?: number;
  readonly name?: string;
  readonly school?: string;
}

export type EventFamily =
  | "cast"
  | "damage"
  | "heal"
  | "miss"
  | "absorb"
  | "aura"
  | "resource"
  | "summon"
  | "death"
  | "combatant-info"
  | "encounter"
  | "metadata"
  | "version"
  | "generic";

export interface EventPayload {
  readonly family: EventFamily;
  readonly auraType?: string;
  readonly amount?: string;
  readonly failureReason?: string;
  readonly encounterId?: number;
  readonly encounterName?: string;
  readonly success?: boolean;
  readonly combatantGuid?: string;
}

export interface CombatEvent {
  readonly timestamp: RawTimestamp;
  readonly relativeTimeTicks: bigint;
  /** Event name exactly as supplied by WoW. */
  readonly type: string;
  readonly family: EventFamily;
  readonly normalized: boolean;
  readonly source?: ActorReference;
  readonly destination?: ActorReference;
  readonly spell?: SpellReference;
  readonly payload: EventPayload;
  /** Every payload token, including the event name, in its original spelling. */
  readonly rawFields: readonly RawField[];
  readonly additionalFields: readonly string[];
  readonly origin: CombatLogOrigin;
  readonly parserVersion: string;
  readonly schemaId: string;
  readonly raw: string;
  /** Exact source line ending retained for source-compatible export. */
  readonly lineTerminator: SourceLineTerminator;
  /** True when an unrelated actor applied an incoming effect to the primary actor graph. */
  readonly externalEffect?: boolean;
  readonly location: SourceLocation;
}
