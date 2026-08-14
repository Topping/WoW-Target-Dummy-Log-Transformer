import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  CombatLogSchemaRegistry,
  classifyActorGuid,
  defaultSchemaRegistry,
  parseCombatLogText,
  retail12_1_0Schema,
  serializeCombatEvent,
} from "../src/core";

const HEADER =
  "8/14/2026 12:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const COMMON =
  'Player-1,"Pølsefatter-ArgentDawn-EU",0x511,0x80000000,Creature-1,"Training Dummy",0xa28,0x80000000';
const SPELL = '123,"Spell, with comma",0x10';

function line(offset: string, eventType: string, fields: string): string {
  return `8/14/2026 12:00:${offset}  ${eventType},${fields}`;
}

const FAMILY_CASES = [
  ["SPELL_CAST_START", "cast", `${COMMON},${SPELL}`],
  ["SPELL_CAST_SUCCESS", "cast", `${COMMON},${SPELL}`],
  ["SPELL_CAST_FAILED", "cast", `${COMMON},${SPELL},Out of range`],
  ["SPELL_DAMAGE", "damage", `${COMMON},${SPELL},42,nil,AOE`],
  ["SPELL_DAMAGE_SUPPORT", "damage", `${COMMON},${SPELL},42,nil,AOE`],
  ["SPELL_PERIODIC_DAMAGE", "damage", `${COMMON},${SPELL},42`],
  ["SWING_DAMAGE", "damage", `${COMMON},42`],
  [
    "SWING_DAMAGE_LANDED",
    "damage",
    `${COMMON},Creature-1,0000000000000000,104,152,0,0,189,0,1,0,0,0`,
  ],
  ["SWING_MISSED", "miss", `${COMMON},MISS,nil`],
  ["RANGE_DAMAGE", "damage", `${COMMON},${SPELL},42`],
  ["ENVIRONMENTAL_DAMAGE", "damage", `${COMMON},Falling,42`],
  ["SPELL_MISSED", "miss", `${COMMON},${SPELL},MISS,nil,AOE`],
  [
    "SPELL_ABSORBED",
    "absorb",
    `${COMMON},${SPELL},Player-2,"Shield caster",0x518,0x0,456,"Shield",0x2,42,nil`,
  ],
  ["SPELL_HEAL", "heal", `${COMMON},${SPELL},42,0,0,nil`],
  ["SPELL_PERIODIC_HEAL", "heal", `${COMMON},${SPELL},42,0,0,nil`],
  [
    "SPELL_HEAL_ABSORBED",
    "absorb",
    `${COMMON},${SPELL},Player-2,"Absorb caster",0x518,0x0,456,"Absorb",0x2,42,42`,
  ],
  ["SPELL_AURA_APPLIED", "aura", `${COMMON},${SPELL},BUFF`],
  ["SPELL_AURA_REFRESH", "aura", `${COMMON},${SPELL},DEBUFF`],
  ["SPELL_AURA_REMOVED", "aura", `${COMMON},${SPELL},BUFF`],
  ["SPELL_AURA_APPLIED_DOSE", "aura", `${COMMON},${SPELL},BUFF,2`],
  ["SPELL_AURA_REMOVED_DOSE", "aura", `${COMMON},${SPELL},DEBUFF,1`],
  ["SPELL_ENERGIZE", "resource", `${COMMON},${SPELL},20,6`],
  ["SPELL_PERIODIC_ENERGIZE", "resource", `${COMMON},${SPELL},20,6`],
  ["SPELL_DRAIN", "resource", `${COMMON},${SPELL},20,6,5`],
  ["SPELL_EMPOWER_START", "cast", `${COMMON},${SPELL}`],
  ["SPELL_EMPOWER_END", "cast", `${COMMON},${SPELL},3`],
  ["SPELL_SUMMON", "summon", `${COMMON},${SPELL}`],
  ["SPELL_CREATE", "summon", `${COMMON},${SPELL}`],
  ["UNIT_DIED", "death", COMMON],
  ["UNIT_DESTROYED", "death", COMMON],
  ["PARTY_KILL", "death", `${COMMON},0`],
  ["COMBATANT_INFO", "combatant-info", "Player-1,1,2,[(3,4)]"],
  ["ENCOUNTER_START", "encounter", '610,"Example Boss",9,40,469'],
  ["ENCOUNTER_END", "encounter", '610,"Example Boss",9,40,1,1234'],
  ["ZONE_CHANGE", "metadata", '0,"Silvermoon City",0'],
  [
    "MAP_CHANGE",
    "metadata",
    '2393,"Silvermoon City",9772.916016,7902.083008,-3335.416016,-6141.666016',
  ],
] as const;

describe("Retail 12.1.0 event schema", () => {
  it("is registered with stable compatibility metadata", () => {
    expect(defaultSchemaRegistry.get(retail12_1_0Schema.id)).toBe(
      retail12_1_0Schema,
    );
    expect(retail12_1_0Schema).toMatchObject({
      id: "retail-12.1.0-project-1-log-22",
      compatibility: {
        projectId: 1,
        logVersions: [22],
        buildRange: { minimum: "12.1.0", maximum: "12.1.0" },
      },
    });
  });

  it.each(FAMILY_CASES)(
    "normalizes %s as the %s family",
    async (eventType, family, fields) => {
      const result = await parseCombatLogText(
        `${HEADER}\n${line("01.0001", eventType, fields)}`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const event = result.value.records[1];
      expect(event).toMatchObject({
        type: eventType,
        family,
        normalized: true,
        schemaId: retail12_1_0Schema.id,
        parserVersion: "0.2.0",
      });
      expect(event?.rawFields[0]?.raw).toBe(eventType);
      if (eventType === "SWING_DAMAGE_LANDED") {
        expect(event?.spell).toBeUndefined();
        expect(event?.additionalFields).toEqual([
          "Creature-1",
          "0000000000000000",
          "104",
          "152",
          "0",
          "0",
          "189",
          "0",
          "1",
          "0",
          "0",
          "0",
        ]);
      }
      if (eventType === "SWING_MISSED") {
        expect(event?.spell).toBeUndefined();
        expect(event?.additionalFields).toEqual(["MISS", "nil"]);
      }
      if (eventType === "ENVIRONMENTAL_DAMAGE") {
        expect(event?.spell).toBeUndefined();
      }
      if (eventType === "SPELL_ABSORBED") {
        expect(event?.spell).toMatchObject({
          id: 123,
          name: "Spell, with comma",
          school: "0x10",
        });
      }
      if (eventType === "SPELL_HEAL" || eventType === "SPELL_PERIODIC_HEAL") {
        expect(event?.spell).toMatchObject({
          id: 123,
          name: "Spell, with comma",
          school: "0x10",
        });
      }
      if (
        ![
          "COMBATANT_INFO",
          "ENCOUNTER_START",
          "ENCOUNTER_END",
          "ZONE_CHANGE",
          "MAP_CHANGE",
        ].includes(eventType)
      ) {
        expect(event?.source).toMatchObject({
          guid: "Player-1",
          name: "Pølsefatter-ArgentDawn-EU",
          type: "player",
        });
        expect(event?.destination).toMatchObject({
          guid: "Creature-1",
          type: "creature",
        });
      }
    },
  );

  it("retains naturally occurring combatant and encounter metadata", async () => {
    const text = [
      HEADER,
      line("01.0000", "ENCOUNTER_START", '610,"Example Boss",9,40,469'),
      line("01.0000", "COMBATANT_INFO", "Player-1,1,2,[(3,4)]"),
      line("04.0000", "ENCOUNTER_END", '610,"Example Boss",9,40,1,3000'),
    ].join("\n");
    const result = await parseCombatLogText(text);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.records.map((event) => event.type)).toEqual([
      "COMBAT_LOG_VERSION",
      "ENCOUNTER_START",
      "COMBATANT_INFO",
      "ENCOUNTER_END",
    ]);
    expect(result.value.records[2]?.payload.combatantGuid).toBe("Player-1");
    expect(result.value.records[3]?.payload.success).toBe(true);
  });

  it("normalizes swing-triggered absorbs without inventing a spell prefix", async () => {
    const fields = `${COMMON},Player-2,"Shield caster",0x518,0x0,456,"Shield",0x2,42,nil`;
    const result = await parseCombatLogText(
      `${HEADER}\n${line("01.0001", "SPELL_ABSORBED", fields)}`,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.records[1]).toMatchObject({
      type: "SPELL_ABSORBED",
      family: "absorb",
      normalized: true,
      additionalFields: [
        "Player-2",
        "Shield caster",
        "0x518",
        "0x0",
        "456",
        "Shield",
        "0x2",
        "42",
        "nil",
      ],
    });
    expect(result.value.records[1]?.spell).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("retains unknown events and short supported records as generic raw records", async () => {
    const unknown = line("01.0000", "FUTURE_EVENT", `${COMMON},"unknown",nil`);
    const short = line("02.0000", "SPELL_DAMAGE", "Player-1");
    const result = await parseCombatLogText(
      [HEADER, unknown, short].join("\n"),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.records.slice(1)).toMatchObject([
      {
        type: "FUTURE_EVENT",
        family: "generic",
        normalized: false,
        raw: unknown,
      },
      {
        type: "SPELL_DAMAGE",
        family: "generic",
        normalized: false,
        raw: short,
      },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "UNKNOWN_EVENT_TYPE",
      "UNEXPECTED_FIELD_COUNT",
    ]);
    expect(result.warnings[1]?.context).toMatchObject({
      location: { lineNumber: 3 },
      schemaId: retail12_1_0Schema.id,
      rawLine: short,
    });
  });

  it("returns a typed recoverable structural failure with source context", async () => {
    const malformed = '8/14/2026 12:00:01.0000  SPELL_DAMAGE,"unterminated';
    const result = await parseCombatLogText(`${HEADER}\n${malformed}`);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "MALFORMED_CSV_QUOTE",
        recoverable: true,
        technicalDetails: {
          location: { lineNumber: 2 },
          rawLine: malformed,
        },
      },
    });
  });

  it("preserves Unicode, nil, hexadecimal, and advanced logging tails", async () => {
    const fixture = await readFile(
      "tests/fixtures/derived/current-retail-samples.log",
      "utf8",
    );
    const result = await parseCombatLogText(fixture);
    if (!result.ok) throw new Error(result.error.message);
    const damage = result.value.records.find(
      (event) => event.type === "SPELL_DAMAGE",
    );
    expect(damage?.source).toMatchObject({
      name: "Pølsefatter-ArgentDawn-EU",
      flags: "0x511",
    });
    expect(damage?.rawFields.some((field) => field.value === "nil")).toBe(true);
    expect(damage?.additionalFields).toContain("AOE");
    expect(damage?.raw).toContain('"Pølsefatter-ArgentDawn-EU"');
  });
});

describe("schema selection", () => {
  it("prefers an exact match", async () => {
    const result = await parseCombatLogText(HEADER);
    expect(result).toMatchObject({
      ok: true,
      value: {
        parser: {
          schema: { id: retail12_1_0Schema.id, selection: "exact" },
        },
      },
      warnings: [],
    });
  });

  it("falls back to the latest schema for the same project and records it", async () => {
    const futureHeader = HEADER.replace(
      "22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0",
      "23,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.2.0",
    );
    const result = await parseCombatLogText(futureHeader);
    expect(result).toMatchObject({
      ok: true,
      value: { parser: { schema: { selection: "fallback" } } },
      warnings: [{ code: "SCHEMA_FALLBACK" }],
    });
  });

  it("chooses the newest installed same-project schema during fallback", () => {
    const olderSchema = {
      ...retail12_1_0Schema,
      id: "retail-11.2.0-project-1-log-21",
      compatibility: {
        projectId: 1,
        logVersions: [21],
        buildRange: { minimum: "11.2.0", maximum: "11.2.0" },
      },
    };
    const registry = new CombatLogSchemaRegistry([
      olderSchema,
      retail12_1_0Schema,
    ]);
    const selected = registry.select({
      projectId: 1,
      logVersion: 99,
      buildVersion: "13.0.0",
      advancedLoggingEnabled: true,
    });
    expect(selected).toMatchObject({
      ok: true,
      value: { schema: { id: retail12_1_0Schema.id }, selection: "fallback" },
    });
  });

  it("fails recoverably when no schema exists for the project", async () => {
    const otherProject = HEADER.replace("PROJECT_ID,1", "PROJECT_ID,99");
    expect(await parseCombatLogText(otherProject)).toMatchObject({
      ok: false,
      error: { code: "NO_COMPATIBLE_SCHEMA", recoverable: true },
    });
  });

  it("supports a developer manual override", async () => {
    const registry = new CombatLogSchemaRegistry([retail12_1_0Schema]);
    const result = await parseCombatLogText(HEADER, {
      registry,
      manualSchemaId: retail12_1_0Schema.id,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { parser: { schema: { selection: "manual-override" } } },
    });
  });

  it("retains a caller-supplied synthetic origin", async () => {
    const result = await parseCombatLogText(HEADER, { origin: "synthetic" });
    expect(result).toMatchObject({
      ok: true,
      value: { records: [{ origin: "synthetic" }] },
    });
  });
});

describe("GUID actor classification", () => {
  it.each([
    ["Player-1", "player"],
    ["Creature-1", "creature"],
    ["Pet-1", "pet"],
    ["Guardian-1", "guardian"],
    ["Vehicle-1", "vehicle"],
    ["0000000000000000", "unknown"],
    ["nil", "unknown"],
  ] as const)("classifies %s as %s", (guid, expected) => {
    expect(classifyActorGuid(guid)).toBe(expected);
  });
});

describe("semantic raw-record round trips", () => {
  it("parse/serialize/parses supported, unknown, Unicode, and advanced records", async () => {
    const fixture = await readFile(
      "tests/fixtures/derived/current-retail-samples.log",
      "utf8",
    );
    const first = await parseCombatLogText(fixture);
    if (!first.ok) throw new Error(first.error.message);
    const serialized = first.value.records.map(serializeCombatEvent).join("\n");
    const second = await parseCombatLogText(serialized);
    if (!second.ok) throw new Error(second.error.message);

    const semanticShape = (event: (typeof first.value.records)[number]) => ({
      type: event.type,
      family: event.family,
      normalized: event.normalized,
      timestamp: event.timestamp,
      source: event.source,
      destination: event.destination,
      spell: event.spell,
      rawFieldValues: event.rawFields.map((field) => field.value),
      additionalFields: event.additionalFields,
    });
    expect(second.value.records.map(semanticShape)).toEqual(
      first.value.records.map(semanticShape),
    );
    expect(serialized).toBe(fixture.trimEnd());
  });
});
