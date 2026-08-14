export const SIMC_EQUIPMENT_SLOTS = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "shirt",
  "tabard",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "main_hand",
  "off_hand",
  "ammo",
] as const;

export type SimcEquipmentSlot = (typeof SIMC_EQUIPMENT_SLOTS)[number];

export const WOW_CLASSES = [
  "death_knight",
  "demon_hunter",
  "druid",
  "evoker",
  "hunter",
  "mage",
  "monk",
  "paladin",
  "priest",
  "rogue",
  "shaman",
  "warlock",
  "warrior",
] as const;

export type WowClass = (typeof WOW_CLASSES)[number];

export type SimcProfileFailureCode =
  | "SIMC_PROFILE_TOO_LARGE"
  | "SIMC_PROFILE_MALFORMED"
  | "SIMC_PROFILE_NOT_ADDON_EXPORT"
  | "SIMC_MULTIPLE_ACTIVE_CHARACTERS"
  | "SIMC_MISSING_REQUIRED_FIELD";

export type SimcProfileWarningCode = "SIMC_MISSING_ITEM_LEVEL";

export interface SimcAddonProvenance {
  readonly addonVersion?: string;
  readonly wowVersion?: string;
  readonly wowBuild?: string;
  readonly tocVersion?: number;
}

export interface SimcEquippedItem {
  readonly slot: SimcEquipmentSlot;
  readonly itemId: number;
  readonly itemLevel?: number;
  readonly enchantId?: number;
  readonly gemIds: readonly number[];
  readonly bonusIds: readonly number[];
  readonly options: Readonly<Record<string, string>>;
}

export interface ParsedSimcAddonProfile {
  readonly provenance: SimcAddonProvenance;
  readonly characterName: string;
  readonly class: WowClass;
  readonly level: number;
  readonly race: string;
  readonly region: string;
  readonly server: string;
  readonly spec: string;
  readonly talentExport: string;
  readonly equipment: readonly SimcEquippedItem[];
}
