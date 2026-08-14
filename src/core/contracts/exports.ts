export type SessionExportKind = "json" | "encounter-log";

export type SessionExportWarningCode =
  | "EXPORT_SOFT_BYTE_LIMIT_EXCEEDED"
  | "WOWCOACH_SYNTHETIC_ENCOUNTER_ENVELOPE_USED"
  | "SIMC_DEFAULTED_COMBATANT_STATS"
  | "SIMC_DEFAULTED_COMBATANT_AURAS"
  | "SIMC_DEFAULTED_GEM_ITEM_LEVELS";
export type SessionExportFailureCode =
  | "EXPORT_HARD_BYTE_LIMIT_EXCEEDED"
  | "SIMC_PROFILE_REQUIRED"
  | "SIMC_CHARACTER_MISMATCH"
  | "INVALID_BUILT_COMBATANT_INFO";

export interface SessionExportSizeLimits {
  readonly softByteLimit?: number;
  readonly hardByteLimit?: number;
}

export interface SessionExportOptions {
  readonly sizeLimits?: SessionExportSizeLimits;
}

export interface EncounterLogExportOptions extends SessionExportOptions {
  readonly combatantInfo: import("../combatantInfo/contracts").BuiltCombatantInfo;
}

export interface SerializedSessionExport {
  readonly content: string;
  readonly mediaType: string;
  readonly byteLength: number;
}
