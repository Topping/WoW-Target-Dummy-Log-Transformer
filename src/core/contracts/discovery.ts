import type { ActorReference } from "./actors";
import type { NonEmptyReadonlyArray, RawTimestamp } from "./common";
import type { ParserMetadata } from "./parser";

export interface InputFileMetadata {
  readonly name: string;
  readonly sizeBytes: number;
  readonly lastModifiedMs?: number;
}

export interface ConfidenceReason {
  readonly code: string;
  readonly description: string;
}

export type SessionConfidence = "likely" | "possible" | "incidental";

export interface PlayerCandidate extends ActorReference {
  readonly activityScore: number;
  readonly recorderCandidate: boolean;
}

export interface TargetCandidate extends ActorReference {
  readonly interactionCount: number;
  readonly damageFromPlayer: number;
}

export interface SessionCandidate {
  readonly id: string;
  readonly playerGuid: string;
  readonly targetGuids: NonEmptyReadonlyArray<string>;
  readonly startTime: RawTimestamp;
  readonly endTime: RawTimestamp;
  readonly durationTicks: bigint;
  readonly confidence: SessionConfidence;
  readonly reasons: readonly ConfidenceReason[];
}

export interface DiscoveryResult {
  readonly parser: ParserMetadata;
  readonly file: InputFileMetadata;
  readonly players: readonly PlayerCandidate[];
  readonly targets: readonly TargetCandidate[];
  readonly sessions: readonly SessionCandidate[];
  readonly recordsScanned: number;
}
