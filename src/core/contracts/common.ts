/** A non-empty immutable collection, used where an empty value is invalid. */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export interface SourceLocation {
  readonly lineNumber: number;
  readonly byteOffset?: number;
}

export interface RawTimestamp {
  /** Timestamp exactly as it appeared in the combat log. */
  readonly raw: string;
  /** Exact timezone-unspecified local time, measured in 100-microsecond ticks. */
  readonly localTimeTicks: bigint;
  readonly fractionalComponent: string;
}

export type CombatLogOrigin = "combat-log" | "synthetic";
