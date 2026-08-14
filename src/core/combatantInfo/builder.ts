import type { Actor, OperationResult, ParserWarning } from "../contracts";
import { parserWarning } from "../parser/diagnostics";
import {
  parseSimcAddonProfile,
  type ParsedSimcAddonProfile,
  type SimcEquipmentSlot,
} from "../simc";
import type {
  BuildSimcCombatantInfoOptions,
  BuiltCombatantInfo,
  CharacterFaction,
  CombatantInfoFailureCode,
  DecodedTalentLoadout,
} from "./contracts";
import { decodeTalentExport, decodeTalentExportHeader } from "./talents";
import { validateV22CombatantInfo } from "./validator";
import { INSTALLED_TALENT_SNAPSHOTS } from "./data/installed";

export const V22_COMBATANT_INFO_SCHEMA_ID = "retail-12.1.0-project-1-log-22";

const SPEC_IDS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  death_knight: { blood: 250, frost: 251, unholy: 252 },
  demon_hunter: { havoc: 577, vengeance: 581, devourer: 1480 },
  druid: { balance: 102, feral: 103, guardian: 104, restoration: 105 },
  evoker: { devastation: 1467, preservation: 1468, augmentation: 1473 },
  hunter: { beast_mastery: 253, marksmanship: 254, survival: 255 },
  mage: { arcane: 62, fire: 63, frost: 64 },
  monk: { brewmaster: 268, windwalker: 269, mistweaver: 270 },
  paladin: { holy: 65, protection: 66, retribution: 70 },
  priest: { discipline: 256, holy: 257, shadow: 258 },
  rogue: { assassination: 259, outlaw: 260, subtlety: 261 },
  shaman: { elemental: 262, enhancement: 263, restoration: 264 },
  warlock: { affliction: 265, demonology: 266, destruction: 267 },
  warrior: { arms: 71, fury: 72, protection: 73 },
};

const ALLIANCE_RACES = new Set([
  "human",
  "dwarf",
  "night_elf",
  "gnome",
  "draenei",
  "worgen",
  "void_elf",
  "lightforged_draenei",
  "dark_iron_dwarf",
  "kul_tiran",
  "mechagnome",
]);
const HORDE_RACES = new Set([
  "orc",
  "undead",
  "tauren",
  "troll",
  "blood_elf",
  "goblin",
  "nightborne",
  "highmountain_tauren",
  "maghar_orc",
  "zandalari_troll",
  "vulpera",
]);

const V22_SLOT_ORDER: readonly (SimcEquipmentSlot | undefined)[] = [
  "head",
  "neck",
  "shoulder",
  "shirt",
  "chest",
  "waist",
  "legs",
  "feet",
  "wrist",
  "hands",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "back",
  "main_hand",
  "off_hand",
  "tabard",
];

function buildFailure(
  code: CombatantInfoFailureCode,
  message: string,
  suggestedAction: string,
): OperationResult<never> {
  return {
    ok: false,
    error: {
      category:
        code === "SIMC_CHARACTER_MISMATCH"
          ? "invalid-combat-log"
          : "unsupported-log-format",
      code,
      message,
      recoverable: true,
      suggestedAction,
    },
    warnings: [],
  };
}

function normalizedCharacterName(value: string): string {
  return (value.split("-")[0] ?? value).normalize("NFC").toLocaleLowerCase();
}

function expectedProfileSpecId(
  profile: ParsedSimcAddonProfile,
): number | undefined {
  return SPEC_IDS[profile.class]?.[profile.spec.toLocaleLowerCase()];
}

export function profileMatchesPlayer(
  profile: ParsedSimcAddonProfile,
  player: Pick<Actor, "name">,
): boolean {
  return (
    player.name !== undefined &&
    normalizedCharacterName(profile.characterName) ===
      normalizedCharacterName(player.name)
  );
}

export function deriveFaction(race: string): CharacterFaction | undefined {
  const normalized = race
    .trim()
    .toLocaleLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
  if (ALLIANCE_RACES.has(normalized)) return "alliance";
  if (HORDE_RACES.has(normalized)) return "horde";
  return undefined;
}

function tuple(values: readonly (string | number)[]): string {
  return `(${values.join(",")})`;
}

function array(values: readonly string[]): string {
  return `[${values.join(",")}]`;
}

function serializeEquipment(profile: ParsedSimcAddonProfile): string {
  const items = new Map(profile.equipment.map((item) => [item.slot, item]));
  return array(
    V22_SLOT_ORDER.map((slot) => {
      const item = slot === undefined ? undefined : items.get(slot);
      if (item === undefined) return tuple([0, 0, "()", "()", "()"]);
      const enchants =
        item.enchantId === undefined || item.enchantId === 0
          ? "()"
          : tuple([item.enchantId, 0, 0]);
      const bonuses = tuple(item.bonusIds);
      const gems = tuple(item.gemIds.flatMap((gemId) => [gemId, 0]));
      return tuple([item.itemId, item.itemLevel ?? 0, enchants, bonuses, gems]);
    }),
  );
}

export function buildV22CombatantInfo(
  player: Pick<Actor, "guid" | "name">,
  profile: ParsedSimcAddonProfile,
  loadout: DecodedTalentLoadout,
  faction: CharacterFaction,
): OperationResult<BuiltCombatantInfo> {
  if (!profileMatchesPlayer(profile, player)) {
    return buildFailure(
      "SIMC_CHARACTER_MISMATCH",
      "The pasted SimulationCraft profile belongs to a different character.",
      "Run /simc on the character selected from this combat log and paste that output.",
    );
  }
  if (
    profile.provenance.wowVersion !== undefined &&
    profile.provenance.wowVersion !== "12.1.0"
  ) {
    return buildFailure(
      "SIMC_UNSUPPORTED_WOW_BUILD",
      "The pasted profile was created by a different World of Warcraft version than this combat log.",
      "Run /simc in the same game version that produced this combat log.",
    );
  }
  const expectedSpec = expectedProfileSpecId(profile);
  if (expectedSpec === undefined || expectedSpec !== loadout.specId) {
    return buildFailure(
      "SIMC_CLASS_SPEC_MISMATCH",
      "The profile's class/spec text does not match its Blizzard talent loadout.",
      "Activate the intended specialization, run /simc again, and paste the complete output.",
    );
  }
  const missingLevels = profile.equipment.filter(
    (item) => item.itemLevel === undefined,
  );
  if (missingLevels.length > 0) {
    return buildFailure(
      "SIMC_MISSING_ITEM_LEVEL",
      "One or more equipped items have no item level in the pasted profile.",
      "Wait for item information to load in game, run /simc again, and copy the complete output including item comments.",
    );
  }
  const factionValue = faction === "alliance" ? 1 : 0;
  const unavailableScalars = Array.from({ length: 22 }, () => "0");
  const talents = array(
    loadout.talents.map((talent) =>
      tuple([talent.nodeId, talent.entryId, talent.rank]),
    ),
  );
  const fields = [
    player.guid,
    String(factionValue),
    ...unavailableScalars,
    String(loadout.specId),
    talents,
    tuple([0]),
    serializeEquipment(profile),
    array([]),
    "10",
    "0",
    "0",
    "0",
  ];
  const eventPayload = `COMBATANT_INFO,${fields.join(",")}`;
  const validation = validateV22CombatantInfo(eventPayload);
  if (!validation.ok) return validation;
  const warnings: ParserWarning[] = [
    parserWarning(
      "SIMC_DEFAULTED_COMBATANT_STATS",
      "Live character stats are not included in /simc output and use the V22 adapter defaults.",
    ),
    parserWarning(
      "SIMC_DEFAULTED_COMBATANT_AURAS",
      "Pull-time auras are not included in /simc output and are left empty.",
    ),
  ];
  if (profile.equipment.some((item) => item.gemIds.length > 0)) {
    warnings.push(
      parserWarning(
        "SIMC_DEFAULTED_GEM_ITEM_LEVELS",
        "Gem item levels are not included in /simc output and use the V22 adapter default.",
      ),
    );
  }
  return {
    ok: true,
    value: {
      eventPayload,
      playerGuid: player.guid,
      schemaId: V22_COMBATANT_INFO_SCHEMA_ID,
      profile,
      provenance: {
        identity: "exact",
        spec: "exact",
        talents: "exact",
        equipment: profile.equipment.some((item) => item.gemIds.length > 0)
          ? "partial"
          : "exact",
        stats: "defaulted",
        auras: "defaulted",
      },
    },
    warnings,
  };
}

export function buildSimcCombatantInfo(
  player: Pick<Actor, "guid" | "name">,
  schemaId: string,
  text: string,
  options: BuildSimcCombatantInfoOptions = {},
): OperationResult<BuiltCombatantInfo> {
  if (schemaId !== V22_COMBATANT_INFO_SCHEMA_ID) {
    return buildFailure(
      "SIMC_UNSUPPORTED_WOW_BUILD",
      "Character profile metadata is not supported for this combat-log build.",
      "Update the app for this combat-log version before exporting.",
    );
  }
  const parsed = parseSimcAddonProfile(text);
  if (!parsed.ok) return parsed;
  if (!profileMatchesPlayer(parsed.value, player)) {
    return buildFailure(
      "SIMC_CHARACTER_MISMATCH",
      "The pasted SimulationCraft profile belongs to a different character.",
      "Run /simc on the character selected from this combat log and paste that output.",
    );
  }
  if (
    parsed.value.provenance.wowVersion !== undefined &&
    parsed.value.provenance.wowVersion !== "12.1.0"
  ) {
    return buildFailure(
      "SIMC_UNSUPPORTED_WOW_BUILD",
      "The pasted profile was created by a different World of Warcraft version than this combat log.",
      "Run /simc in the same game version that produced this combat log.",
    );
  }
  const header = decodeTalentExportHeader(parsed.value.talentExport);
  if (!header.ok) return header;
  if (expectedProfileSpecId(parsed.value) !== header.value.specId) {
    return buildFailure(
      "SIMC_CLASS_SPEC_MISMATCH",
      "The profile's class/spec text does not match its Blizzard talent loadout.",
      "Activate the intended specialization, run /simc again, and paste the complete output.",
    );
  }
  const faction = deriveFaction(parsed.value.race) ?? options.faction;
  if (faction === undefined) {
    return buildFailure(
      "SIMC_FACTION_REQUIRED",
      "This race can belong to either faction, so a faction choice is required.",
      "Choose Alliance or Horde to match this character, then use the profile again.",
    );
  }
  const decoded = decodeTalentExport(
    parsed.value.talentExport,
    (options.talentSnapshots ?? INSTALLED_TALENT_SNAPSHOTS).filter(
      (snapshot) => snapshot.schemaId === schemaId,
    ),
    parsed.value.provenance.wowVersion === undefined
      ? {}
      : { wowVersion: parsed.value.provenance.wowVersion },
  );
  if (!decoded.ok) return decoded;
  const built = buildV22CombatantInfo(
    player,
    parsed.value,
    decoded.value,
    faction,
  );
  if (!built.ok) return built;
  return {
    ...built,
    warnings: [...parsed.warnings, ...decoded.warnings, ...built.warnings],
  };
}
