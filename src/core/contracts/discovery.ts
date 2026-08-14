import type { ActorReference } from "./actors";
import type { NonEmptyReadonlyArray, RawTimestamp } from "./common";
import type { ParserMetadata } from "./parser";

export interface InputFileMetadata {
  readonly name: string;
  readonly sizeBytes: number;
  readonly lastModifiedMs?: number;
}

export type ConfidenceReasonCode =
  | "PLAYER_INTENT_PRESENT"
  | "MULTIPLE_PLAYER_ACTIONS"
  | "MINIMUM_DURATION_MET"
  | "SUSTAINED_ACTIVITY"
  | "SHORT_DURATION"
  | "SPARSE_ACTIVITY"
  | "PASSIVE_OR_OWNED_ACTIVITY_ONLY"
  | "NON_PLAYER_TARGET"
  | "MULTI_TARGET";

export interface ConfidenceReason {
  readonly code: ConfidenceReasonCode;
  readonly description: string;
}

export type SessionConfidence = "likely" | "possible" | "incidental";

export interface PlayerCandidate extends ActorReference {
  readonly activityScore: number;
  readonly recorderCandidate: boolean;
  readonly outgoingCastCount: number;
  readonly outgoingDamageCount: number;
  readonly interactionDurationTicks: bigint;
  readonly targetInteractionCount: number;
}

export interface TargetCandidate extends ActorReference {
  readonly interactionCount: number;
  readonly damageFromPlayer: number;
  readonly interactingPlayerCount: number;
  readonly interactionDurationTicks: bigint;
  readonly activityScore: number;
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
  readonly qualifyingActionCount: number;
  readonly playerInitiatedActionCount: number;
}

export interface EncounterEnvelope {
  readonly startTime: RawTimestamp;
  readonly endTime?: RawTimestamp;
  readonly encounterId?: number;
  readonly name?: string;
  readonly success?: boolean;
}

export interface OwnedEntityObservation extends ActorReference {
  readonly ownerGuid: string;
  readonly evidence: "summon" | "create" | "affiliation-mine";
}

export interface DiscoveryRetentionSummary {
  readonly actorCount: number;
  readonly targetCount: number;
  readonly candidateWindowCount: number;
  readonly ownedEntityCount: number;
  readonly encounterEnvelopeCount: number;
  readonly retainedCombatEventCount: 0;
  readonly retainedRawLineCount: 0;
}

export interface SessionDiscoveryOptions {
  readonly inactivityThresholdMs?: number;
  readonly likelyMinimumDurationMs?: number;
  readonly likelyMinimumPlayerInitiatedActions?: number;
  readonly likelyMinimumQualifyingActions?: number;
  readonly includeIncidental?: boolean;
}

export interface ResolvedSessionDiscoveryOptions {
  readonly inactivityThresholdMs: number;
  readonly likelyMinimumDurationMs: number;
  readonly likelyMinimumPlayerInitiatedActions: number;
  readonly likelyMinimumQualifyingActions: number;
  readonly includeIncidental: boolean;
}

export interface DiscoveryResult {
  readonly parser: ParserMetadata;
  readonly file: InputFileMetadata;
  readonly players: readonly PlayerCandidate[];
  /** Present only when exactly one player GUID/type carries AFFILIATION_MINE. */
  readonly proposedRecorderGuid?: string;
  readonly targets: readonly TargetCandidate[];
  readonly sessions: readonly SessionCandidate[];
  readonly ownedEntities: readonly OwnedEntityObservation[];
  readonly encounterEnvelopes: readonly EncounterEnvelope[];
  readonly recordsScanned: number;
  readonly retainedState: DiscoveryRetentionSummary;
}
