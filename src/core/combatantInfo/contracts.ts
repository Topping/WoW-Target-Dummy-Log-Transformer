import type { ParsedSimcAddonProfile } from "../simc";

export type CharacterFaction = "alliance" | "horde";

export type CombatantInfoFailureCode =
  | "SIMC_CHARACTER_MISMATCH"
  | "SIMC_CLASS_SPEC_MISMATCH"
  | "SIMC_UNSUPPORTED_WOW_BUILD"
  | "SIMC_UNSUPPORTED_TALENT_SERIALIZATION"
  | "SIMC_TALENT_TREE_HASH_MISMATCH"
  | "SIMC_MISSING_ITEM_LEVEL"
  | "SIMC_FACTION_REQUIRED"
  | "INVALID_BUILT_COMBATANT_INFO";

export type CombatantInfoWarningCode =
  | "SIMC_DEFAULTED_COMBATANT_STATS"
  | "SIMC_DEFAULTED_COMBATANT_AURAS"
  | "SIMC_DEFAULTED_GEM_ITEM_LEVELS";

export interface DecodedTalentLoadout {
  readonly serializationVersion: number;
  readonly specId: number;
  readonly treeHash: string;
  readonly talents: readonly DecodedTalent[];
}

export interface DecodedTalent {
  readonly nodeId: number;
  readonly entryId: number;
  readonly rank: number;
}

export interface TalentTreeNodeSnapshot {
  readonly nodeId: number;
  readonly maxRanks: number;
  /** Blizzard TraitNodeType: Single, Tiered, Selection, or SubTreeSelection. */
  readonly nodeType?: 0 | 1 | 2 | 3;
  readonly entryIds: readonly number[];
  /** Required for tiered nodes whose purchased ranks span several entries. */
  readonly entryMaxRanks?: readonly number[];
}

export interface TalentTreeSnapshot {
  readonly schemaId: string;
  readonly serializationVersion: number;
  readonly specId: number;
  /** Exact compatibility key when it is available from a genuine game token. */
  readonly treeHash?: string;
  /** Build-family key for generated third-party tree data without Blizzard's runtime-only hash. */
  readonly wowVersion?: string;
  readonly nodes: readonly TalentTreeNodeSnapshot[];
}

export interface CombatantInfoProvenance {
  readonly identity: "exact";
  readonly spec: "exact";
  readonly talents: "exact";
  readonly equipment: "exact" | "partial";
  readonly stats: "defaulted";
  readonly auras: "defaulted";
}

export interface BuiltCombatantInfo {
  /** Complete event payload beginning with `COMBATANT_INFO,` (no timestamp). */
  readonly eventPayload: string;
  readonly playerGuid: string;
  readonly schemaId: string;
  readonly profile: ParsedSimcAddonProfile;
  readonly provenance: CombatantInfoProvenance;
}

export interface BuildSimcCombatantInfoOptions {
  readonly faction?: CharacterFaction;
  /** Primarily for deterministic tests and checked-in generated snapshots. */
  readonly talentSnapshots?: readonly TalentTreeSnapshot[];
}
