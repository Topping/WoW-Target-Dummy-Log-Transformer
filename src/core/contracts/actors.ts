export type ActorType =
  "player" | "creature" | "pet" | "guardian" | "vehicle" | "unknown";

export type ActorRelationship =
  "primary" | "owned-by-primary" | "target" | "external" | "unknown";

export type OwnershipEvidence =
  "advanced-owner-guid" | "summon" | "create" | "affiliation-mine";

export interface ActorReference {
  readonly guid: string;
  readonly name?: string;
  readonly flags?: string;
  readonly raidFlags?: string;
}

export interface Actor extends ActorReference {
  readonly type: ActorType;
  readonly relationship: ActorRelationship;
  readonly ownerGuid?: string;
  readonly ownershipEvidence?: readonly OwnershipEvidence[];
}
