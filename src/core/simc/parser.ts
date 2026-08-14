import type { OperationResult, ParserWarning } from "../contracts";
import { parserWarning } from "../parser/diagnostics";
import {
  SIMC_EQUIPMENT_SLOTS,
  WOW_CLASSES,
  type ParsedSimcAddonProfile,
  type SimcAddonProvenance,
  type SimcEquipmentSlot,
  type SimcEquippedItem,
  type SimcProfileFailureCode,
  type WowClass,
} from "./contracts";

const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_LINES = 10_000;
const MAX_LINE_LENGTH = 16 * 1024;
const EQUIPMENT_SLOTS = new Set<string>(SIMC_EQUIPMENT_SLOTS);
const CLASS_DECLARATIONS: Readonly<Record<string, WowClass>> = {
  ...Object.fromEntries(WOW_CLASSES.map((wowClass) => [wowClass, wowClass])),
  deathknight: "death_knight",
  demonhunter: "demon_hunter",
};
const SAFE_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const SCALAR_KEYS = new Set([
  "level",
  "race",
  "region",
  "server",
  "role",
  "spec",
  "talents",
]);
const ALLOWED_IGNORED_KEYS = new Set([
  "professions",
  "position",
  "thumbnail",
  "renown",
  "covenant",
  "soulbind",
  "zandalari_loa",
  "omnium_talents",
]);

function failure(
  code: SimcProfileFailureCode,
  message: string,
  suggestedAction: string,
): OperationResult<never> {
  return {
    ok: false,
    error: {
      category: "invalid-combat-log",
      code,
      message,
      recoverable: true,
      suggestedAction,
    },
    warnings: [],
  };
}

function invalidProfile(message: string): OperationResult<never> {
  return failure(
    "SIMC_PROFILE_MALFORMED",
    message,
    "Run /simc in World of Warcraft again, then copy and paste the complete addon output.",
  );
}

function parseInteger(value: string): number | undefined {
  if (!SAFE_INTEGER.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 0x7fffffff
    ? parsed
    : undefined;
}

function parseIntegerList(
  value: string | undefined,
): readonly number[] | undefined {
  if (value === undefined || value.length === 0) return [];
  const parts = value.split("/");
  if (parts.some((part) => part.length === 0)) return undefined;
  const values = parts.map((part) => parseInteger(part));
  return values.some((part) => part === undefined)
    ? undefined
    : (values as number[]);
}

function unquote(value: string): string | undefined {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"') || value.length < 2) return undefined;
  const body = value.slice(1, -1);
  return body.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function parseProvenance(
  line: string,
  provenance: SimcAddonProvenance,
): SimcAddonProvenance {
  const addon = /^#\s*SimC Addon\s+(.+?)\s*$/iu.exec(line);
  if (addon?.[1] !== undefined) {
    return { ...provenance, addonVersion: addon[1] };
  }
  const wow =
    /^#\s*WoW\s+([0-9]+(?:\.[0-9]+)*)\.([0-9]+)\s*,\s*TOC\s+([0-9]+)/iu.exec(
      line,
    );
  if (wow === null) return provenance;
  const next: {
    addonVersion?: string;
    wowVersion?: string;
    wowBuild?: string;
    tocVersion?: number;
  } = { ...provenance };
  if (wow[1] !== undefined) next.wowVersion = wow[1];
  if (wow[2] !== undefined) next.wowBuild = wow[2];
  if (wow[3] !== undefined) {
    const toc = Number(wow[3]);
    if (Number.isSafeInteger(toc)) next.tocVersion = toc;
  }
  return next;
}

function parseItem(
  slot: SimcEquipmentSlot,
  value: string,
  commentItemLevel: number | undefined,
): OperationResult<SimcEquippedItem> {
  const components = value.split(",");
  if (components.length < 2) {
    return invalidProfile(`The active ${slot} equipment line is incomplete.`);
  }
  const optionEntries = new Map<string, string>();
  for (const component of components.slice(1)) {
    const separator = component.indexOf("=");
    if (separator <= 0 || separator === component.length - 1) {
      return invalidProfile(
        `The active ${slot} equipment line has an invalid option.`,
      );
    }
    const key = component.slice(0, separator).trim();
    const optionValue = component.slice(separator + 1).trim();
    if (optionEntries.has(key) && optionEntries.get(key) !== optionValue) {
      return invalidProfile(
        `The active ${slot} equipment line contains conflicting ${key} options.`,
      );
    }
    optionEntries.set(key, optionValue);
  }
  const options = Object.fromEntries(optionEntries);
  const itemId =
    options["id"] === undefined ? undefined : parseInteger(options["id"]);
  if (itemId === undefined || itemId === 0) {
    return invalidProfile(
      `The active ${slot} equipment line does not contain a valid item ID.`,
    );
  }
  const explicitLevel =
    options["ilevel"] === undefined
      ? undefined
      : parseInteger(options["ilevel"]);
  if (options["ilevel"] !== undefined && explicitLevel === undefined) {
    return invalidProfile(
      `The active ${slot} equipment line has an invalid item level.`,
    );
  }
  const enchantId =
    options["enchant_id"] === undefined
      ? undefined
      : parseInteger(options["enchant_id"]);
  if (options["enchant_id"] !== undefined && enchantId === undefined) {
    return invalidProfile(
      `The active ${slot} equipment line has an invalid enchant ID.`,
    );
  }
  const gemIds = parseIntegerList(options["gem_id"]);
  const bonusIds = parseIntegerList(options["bonus_id"]);
  if (gemIds === undefined || bonusIds === undefined) {
    return invalidProfile(
      `The active ${slot} equipment line contains an invalid numeric ID list.`,
    );
  }
  const itemLevel = explicitLevel ?? commentItemLevel;
  return {
    ok: true,
    value: {
      slot,
      itemId,
      ...(itemLevel === undefined ? {} : { itemLevel }),
      ...(enchantId === undefined ? {} : { enchantId }),
      gemIds,
      bonusIds,
      options,
    },
    warnings: [],
  };
}

export function parseSimcAddonProfile(
  text: string,
): OperationResult<ParsedSimcAddonProfile> {
  if (
    text.length > MAX_PROFILE_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES
  ) {
    return failure(
      "SIMC_PROFILE_TOO_LARGE",
      "The pasted SimulationCraft profile is larger than 256 KiB.",
      "Run /simc again and paste only the active character export.",
    );
  }
  if (
    text.includes("\0") ||
    text.includes("\uFFFD") ||
    hasUnpairedSurrogate(text)
  ) {
    return invalidProfile(
      "The pasted profile contains invalid text characters.",
    );
  }
  let lineBreakCount = 0;
  for (const character of text) {
    if (character === "\n") lineBreakCount += 1;
  }
  if (lineBreakCount >= MAX_LINES) {
    return failure(
      "SIMC_PROFILE_TOO_LARGE",
      "The pasted SimulationCraft profile exceeds the supported line limits.",
      "Run /simc again and paste only the active character export.",
    );
  }
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  if (
    lines.length > MAX_LINES ||
    lines.some((line) => line.length > MAX_LINE_LENGTH)
  ) {
    return failure(
      "SIMC_PROFILE_TOO_LARGE",
      "The pasted SimulationCraft profile exceeds the supported line limits.",
      "Run /simc again and paste only the active character export.",
    );
  }

  let provenance: SimcAddonProvenance = {};
  let character: { class: WowClass; name: string } | undefined;
  const scalars = new Map<string, string>();
  const equipment = new Map<SimcEquipmentSlot, SimcEquippedItem>();
  const warnings: ParserWarning[] = [];
  let precedingItemLevel: number | undefined;

  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (line.length === 0) {
      precedingItemLevel = undefined;
      continue;
    }
    if (line.startsWith("#")) {
      provenance = parseProvenance(line, provenance);
      const itemComment = /^#\s*.+\s+\(([0-9]+)\)\s*$/u.exec(line);
      precedingItemLevel =
        itemComment?.[1] === undefined
          ? undefined
          : parseInteger(itemComment[1]);
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0)
      return invalidProfile(
        "The pasted profile contains an invalid active line.",
      );
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const classKey = CLASS_DECLARATIONS[key];
    if (classKey !== undefined) {
      const name = unquote(rawValue);
      if (name === undefined || name.length === 0) {
        return invalidProfile(
          "The active character declaration has an invalid name.",
        );
      }
      if (character !== undefined) {
        return failure(
          "SIMC_MULTIPLE_ACTIVE_CHARACTERS",
          "The pasted profile contains more than one active character declaration.",
          "Paste the output from one /simc window without combining profiles.",
        );
      }
      character = { class: classKey, name };
      precedingItemLevel = undefined;
      continue;
    }
    if (EQUIPMENT_SLOTS.has(key)) {
      const slot = key as SimcEquipmentSlot;
      if (equipment.has(slot)) {
        return invalidProfile(
          `The pasted profile contains more than one active ${slot} line.`,
        );
      }
      const parsed = parseItem(slot, rawValue, precedingItemLevel);
      if (!parsed.ok) return parsed;
      equipment.set(slot, parsed.value);
      precedingItemLevel = undefined;
      continue;
    }
    precedingItemLevel = undefined;
    if (SCALAR_KEYS.has(key)) {
      const value = unquote(rawValue);
      if (value === undefined || value.length === 0) {
        return invalidProfile(`The active ${key} field is invalid.`);
      }
      const previous = scalars.get(key);
      if (previous !== undefined && previous !== value) {
        return invalidProfile(
          `The pasted profile contains conflicting active ${key} fields.`,
        );
      }
      scalars.set(key, value);
      continue;
    }
    if (ALLOWED_IGNORED_KEYS.has(key)) continue;
    return failure(
      "SIMC_PROFILE_NOT_ADDON_EXPORT",
      "The pasted text contains active SimulationCraft instructions that are not part of the supported addon character export.",
      "Paste the complete text produced directly by the SimulationCraft addon /simc command.",
    );
  }

  const missing = [
    "level",
    "race",
    "region",
    "server",
    "spec",
    "talents",
  ].filter((key) => scalars.get(key) === undefined);
  if (provenance.addonVersion === undefined) {
    return failure(
      "SIMC_PROFILE_NOT_ADDON_EXPORT",
      "The pasted text is missing the SimulationCraft addon provenance header.",
      "Paste the complete text produced directly by the SimulationCraft addon /simc command.",
    );
  }
  if (character === undefined || missing.length > 0 || equipment.size === 0) {
    return failure(
      "SIMC_MISSING_REQUIRED_FIELD",
      "The pasted profile is missing required active character, talent, or equipment information.",
      "Run /simc on the matching character and copy the entire output.",
    );
  }
  const levelValue = scalars.get("level");
  const level = levelValue === undefined ? undefined : parseInteger(levelValue);
  if (level === undefined || level === 0)
    return invalidProfile("The active character level is invalid.");
  for (const item of equipment.values()) {
    if (item.itemLevel === undefined) {
      warnings.push(
        parserWarning(
          "SIMC_MISSING_ITEM_LEVEL",
          `The ${item.slot} item has no item level in the addon export.`,
        ),
      );
    }
  }
  return {
    ok: true,
    value: {
      provenance,
      characterName: character.name,
      class: character.class,
      level,
      race: scalars.get("race") ?? "",
      region: scalars.get("region") ?? "",
      server: scalars.get("server") ?? "",
      spec: scalars.get("spec") ?? "",
      talentExport: scalars.get("talents") ?? "",
      equipment: [...equipment.values()],
    },
    warnings,
  };
}
