import { describe, expect, it } from "vitest";

import {
  buildSimcCombatantInfo,
  buildV22CombatantInfo,
  decodeTalentExport,
  decodeTalentExportHeader,
  parseSimcAddonProfile,
  validateV22CombatantInfo,
  V22_COMBATANT_INFO_SCHEMA_ID,
  type TalentTreeSnapshot,
} from "../src/core";
import { INSTALLED_TALENT_SNAPSHOTS } from "../src/core/combatantInfo/data/installed";
import { GENERATED_TALENT_DATA_PROVENANCE } from "../src/core/combatantInfo/data/generated";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function talentToken(
  serializationVersion: number,
  specId: number,
  hashBytes: readonly number[],
  nodeBits: readonly { value: number; count: number }[] = [],
): string {
  const bits: number[] = [];
  const append = (value: number, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      bits.push((value >> index) & 1);
    }
  };
  append(serializationVersion, 8);
  append(specId, 16);
  for (const byte of hashBytes) append(byte, 8);
  for (const entry of nodeBits) append(entry.value, entry.count);
  while (bits.length % 6 !== 0) bits.push(0);
  let result = "";
  for (let offset = 0; offset < bits.length; offset += 6) {
    let value = 0;
    for (let index = 0; index < 6; index += 1) {
      value += (bits[offset + index] ?? 0) * 2 ** index;
    }
    result += ALPHABET[value] ?? "";
  }
  return result;
}

const HASH_BYTES = Array.from({ length: 16 }, (_, index) => index);
const HASH = HASH_BYTES.map((byte) => byte.toString(16).padStart(2, "0")).join(
  "",
);
const TOKEN = talentToken(2, 251, HASH_BYTES, [
  { value: 1, count: 1 },
  { value: 1, count: 1 },
  { value: 0, count: 1 },
  { value: 0, count: 1 },
]);
const PROFILE = `# SimC Addon 12.1.0-01
# WoW 12.1.0.12345, TOC 120100
deathknight="Pølsefatter"
level=80
race=human
region=eu
server=argent_dawn
role=attack
spec=frost
talents=${TOKEN}

# Test Helm (700)
head=,id=1001,bonus_id=10/20,gem_id=3001,enchant_id=4001
# Test Cloak (699)
back=,id=1002
# bag_item,id=9999
`;

describe("bounded SimulationCraft addon profile parser", () => {
  it("accepts the active addon subset, Unicode, CRLF, comments, and item metadata", () => {
    const result = parseSimcAddonProfile(PROFILE.replaceAll("\n", "\r\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      characterName: "Pølsefatter",
      class: "death_knight",
      level: 80,
      race: "human",
      spec: "frost",
      provenance: {
        addonVersion: "12.1.0-01",
        wowVersion: "12.1.0",
        wowBuild: "12345",
      },
    });
    expect(result.value.equipment).toEqual([
      expect.objectContaining({
        slot: "head",
        itemId: 1001,
        itemLevel: 700,
        enchantId: 4001,
        gemIds: [3001],
        bonusIds: [10, 20],
      }),
      expect.objectContaining({
        slot: "back",
        itemId: 1002,
        itemLevel: 699,
      }),
    ]);
  });

  it("requires the literal version/build dot and preserves prototype-named item options safely", () => {
    const unusualOptions = PROFILE.replace(
      "head=,id=1001",
      "head=,id=1001,__proto__=safe,constructor=value,toString=text",
    );
    const parsed = parseSimcAddonProfile(unusualOptions);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const options = parsed.value.equipment[0]?.options;
    expect(options?.["__proto__"]).toBe("safe");
    expect(options?.["constructor"]).toBe("value");
    expect(Reflect.get(options ?? {}, "toString")).toBe("text");
    expect(Object.getPrototypeOf(options)).toBe(Object.prototype);

    const malformedProvenance = parseSimcAddonProfile(
      PROFILE.replace("# WoW 12.1.0.12345", "# WoW 12.1.0x12345"),
    );
    expect(malformedProvenance.ok).toBe(true);
    if (malformedProvenance.ok) {
      expect(malformedProvenance.value.provenance.wowVersion).toBeUndefined();
      expect(malformedProvenance.value.provenance.wowBuild).toBeUndefined();
    }

    expect(
      parseSimcAddonProfile(
        PROFILE.replace(
          "head=,id=1001",
          "head=,id=1001,__proto__=first,__proto__=second",
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMC_PROFILE_MALFORMED" },
    });
  });

  it("ignores commented alternatives and rejects active APL/multiple-character input", () => {
    expect(parseSimcAddonProfile(`${PROFILE}\nactions=/spell`)).toMatchObject({
      ok: false,
      error: { code: "SIMC_PROFILE_NOT_ADDON_EXPORT" },
    });
    expect(parseSimcAddonProfile(`${PROFILE}\nwarrior="Other"`)).toMatchObject({
      ok: false,
      error: { code: "SIMC_MULTIPLE_ACTIVE_CHARACTERS" },
    });
    const parsed = parseSimcAddonProfile(
      PROFILE.replace("# bag_item,id=9999", "# head=other,id=9999"),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.equipment[0]?.itemId).toBe(1001);
  });

  it("fails recoverably for malformed, incomplete, and bounded hostile input", () => {
    expect(
      parseSimcAddonProfile(PROFILE.replace("level=80", "level=-1")),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMC_PROFILE_MALFORMED", recoverable: true },
    });
    expect(
      parseSimcAddonProfile(PROFILE.replace(/^talents=.*$/mu, "")),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMC_MISSING_REQUIRED_FIELD" },
    });
    expect(parseSimcAddonProfile("x".repeat(256 * 1024 + 1))).toMatchObject({
      ok: false,
      error: { code: "SIMC_PROFILE_TOO_LARGE" },
    });
    for (const arbitrary of ["", "=", "\0", "head=x,id=1/2", "🙂=x"]) {
      expect(() => parseSimcAddonProfile(arbitrary)).not.toThrow();
    }
  });
});

describe("Blizzard talent token and V22 character metadata", () => {
  const snapshot: TalentTreeSnapshot = {
    schemaId: V22_COMBATANT_INFO_SCHEMA_ID,
    serializationVersion: 2,
    specId: 251,
    treeHash: HASH,
    nodes: [{ nodeId: 10, maxRanks: 1, entryIds: [20] }],
  };

  it("decodes the versioned header and only accepts an exact tree snapshot", () => {
    expect(decodeTalentExportHeader(TOKEN)).toMatchObject({
      ok: true,
      value: { serializationVersion: 2, specId: 251, treeHash: HASH },
    });
    expect(decodeTalentExport(TOKEN, [])).toMatchObject({
      ok: false,
      error: { code: "SIMC_TALENT_TREE_HASH_MISMATCH" },
    });
    expect(decodeTalentExport(TOKEN, [snapshot])).toMatchObject({
      ok: true,
      value: { talents: [{ nodeId: 10, entryId: 20, rank: 1 }] },
    });
    expect(decodeTalentExport(`${TOKEN}!`, [snapshot])).toMatchObject({
      ok: false,
      error: { code: "SIMC_UNSUPPORTED_TALENT_SERIALIZATION" },
    });
  });

  it("uses generated production data by WoW version without requiring a local game install", () => {
    const generatedSnapshot = INSTALLED_TALENT_SNAPSHOTS.find(
      (candidate) => candidate.specId === 251,
    );
    expect(generatedSnapshot).toBeDefined();
    if (generatedSnapshot === undefined) return;

    const unselectedToken = talentToken(
      2,
      251,
      HASH_BYTES,
      generatedSnapshot.nodes.map(() => ({ value: 0, count: 1 })),
    );
    expect(
      decodeTalentExport(unselectedToken, [generatedSnapshot], {
        wowVersion: GENERATED_TALENT_DATA_PROVENANCE.wowVersion,
      }),
    ).toMatchObject({
      ok: true,
      value: { specId: 251, treeHash: HASH, talents: [] },
    });
    expect(
      decodeTalentExport(unselectedToken, [generatedSnapshot], {
        wowVersion: "different-version",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMC_TALENT_TREE_HASH_MISMATCH" },
    });
    expect(GENERATED_TALENT_DATA_PROVENANCE).toMatchObject({
      environment: "live",
      schemaId: V22_COMBATANT_INFO_SCHEMA_ID,
      serializationVersion: 2,
      specCount: 40,
    });
  });

  it("builds balanced positional V22 metadata bound to the combat-log player", () => {
    const parsed = parseSimcAddonProfile(PROFILE);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const decoded = decodeTalentExport(TOKEN, [snapshot]);
    if (!decoded.ok) throw new Error(decoded.error.message);
    const built = buildV22CombatantInfo(
      { guid: "Player-1", name: "Pølsefatter-ArgentDawn-EU" },
      parsed.value,
      decoded.value,
      "alliance",
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.eventPayload).toContain(
      "COMBATANT_INFO,Player-1,1,0,0,0",
    );
    expect(built.value.eventPayload).toContain("[(10,20,1)]");
    expect(built.value.eventPayload).toContain(
      "(1001,700,(4001,0,0),(10,20),(3001,0))",
    );
    expect(validateV22CombatantInfo(built.value.eventPayload).ok).toBe(true);
    expect(built.warnings.map((warning) => warning.code)).toEqual([
      "SIMC_DEFAULTED_COMBATANT_STATS",
      "SIMC_DEFAULTED_COMBATANT_AURAS",
      "SIMC_DEFAULTED_GEM_ITEM_LEVELS",
    ]);
  });

  it("runs parsing, exact-tree selection, identity checks, and building as one fail-closed operation", () => {
    const result = buildSimcCombatantInfo(
      { guid: "Player-1", name: "Pølsefatter-Realm" },
      V22_COMBATANT_INFO_SCHEMA_ID,
      PROFILE,
      { talentSnapshots: [snapshot] },
    );
    expect(result.ok).toBe(true);
    expect(
      buildSimcCombatantInfo(
        { guid: "Player-1", name: "Pølsefatter-Realm" },
        V22_COMBATANT_INFO_SCHEMA_ID,
        PROFILE,
        {
          talentSnapshots: [{ ...snapshot, schemaId: "different-schema" }],
        },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMC_TALENT_TREE_HASH_MISMATCH" },
    });
    expect(
      buildSimcCombatantInfo(
        { guid: "Player-1", name: "SomeoneElse-Realm" },
        V22_COMBATANT_INFO_SCHEMA_ID,
        PROFILE,
        { talentSnapshots: [snapshot] },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMC_CHARACTER_MISMATCH" },
    });
  });
});
