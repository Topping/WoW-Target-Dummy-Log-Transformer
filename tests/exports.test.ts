import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import sessionSchema from "../docs/session.schema.json";
import {
  DEFAULT_SESSION_EXPORT_SIZE_LIMITS,
  extractSessionText,
  parseCombatLogChunks,
  parseCombatLogText,
  parseSessionJson,
  parseTimestamp,
  serializeEncounterSessionLog,
  serializeSessionJson,
  sessionExportFilename,
  validateV22CombatantInfo,
  type BuiltCombatantInfo,
  type Session,
  type SessionSelection,
} from "../src/core";
import { createSessionDownload } from "../src/worker";

const HEADER =
  "8/14/2026 13:30:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const DAMAGE =
  '8/14/2026 13:30:01.0001  SPELL_DAMAGE,Player-1,"Pølsefatter-ExampleRealm",0x511,0x0,Creature-1,"Target",0xa28,0x0,1,"Strike",0x1,100';
const TRANSPOSED_DAMAGE =
  '8/14/2026 13:30:01.0001  SPELL_DAMAGE,Player-1,"Pølsefatter-ExampleRealm",0x511,0x0,Creature-0-1465-469-4188-12435-00007EE8CE,"Razorgore the Untamed",0xa48,0x0,1,"Strike",0x1,100';
const ADVANCED_DAMAGE =
  '8/14/2026 13:30:01.0001  SPELL_DAMAGE,Player-1,"Pølsefatter-ExampleRealm",0x511,0x0,Creature-1,"Target",0x10a28,0x0,1,"Strike",0x1,Creature-1,0000000000000000,100,100,0,0,0,0,0,0,0,0,0,0,1.0,2.0,2393,0.0,90,100,100,-1,1,0,0,0,nil,nil,nil,ST';
const NOISE =
  '8/14/2026 13:30:01.5000  SPELL_DAMAGE,Player-2,"Nearby",0x518,0x0,Creature-2,"Other",0xa28,0x0,2,"Noise",0x1,50';
const EXTERNAL =
  '8/14/2026 13:30:02.0000  SPELL_AURA_APPLIED,Player-2,"Nearby",0x518,0x0,Player-1,"Pølsefatter-ExampleRealm",0x511,0x0,3,"External",0x1,BUFF';
const NATURAL_COMBATANT_INFO =
  "8/14/2026 13:29:59.0000  COMBATANT_INFO,Player-1,1,1944,513,30352,334,0,0,0,0,1186,1186,1186,98,52,276,276,276,0,1175,34,34,34,1956,251,[(76033,96161,2)],(0),[],[],10,0,0,0";
const SOURCE = `${HEADER}\r\n${DAMAGE}\n${NOISE}\r\n${EXTERNAL}`;

function selection(): SessionSelection {
  const start = parseTimestamp("8/14/2026 13:30:01.0001");
  const end = parseTimestamp("8/14/2026 13:30:02.0000");
  if (!start.ok || !end.ok) throw new Error("fixture timestamps must parse");
  return {
    id: "export-session",
    playerGuid: "Player-1",
    targetGuids: ["Creature-1"],
    startTime: start.value,
    endTime: end.value,
  };
}

async function session(): Promise<Session> {
  const result = await extractSessionText(SOURCE, selection(), {
    includeDebugDecisions: true,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function builtCombatantInfo(
  playerGuid: string,
  faction = "1",
): BuiltCombatantInfo {
  const emptyItem = "(0,0,(),(),())";
  const scalars = Array.from({ length: 22 }, () => "0");
  return {
    eventPayload: `COMBATANT_INFO,${[
      playerGuid,
      faction,
      ...scalars,
      "251",
      "[]",
      "(0)",
      `[${Array.from({ length: 18 }, () => emptyItem).join(",")}]`,
      "[]",
      "10",
      "0",
      "0",
      "0",
    ].join(",")}`,
    playerGuid,
    schemaId: "retail-12.1.0-project-1-log-22",
    profile: {
      provenance: {},
      characterName: "Pølsefatter",
      class: "death_knight",
      level: 80,
      race: "human",
      region: "eu",
      server: "example",
      spec: "frost",
      talentExport: "test",
      equipment: [],
    },
    provenance: {
      identity: "exact",
      spec: "exact",
      talents: "exact",
      equipment: "exact",
      stats: "defaulted",
      auras: "defaulted",
    },
  };
}

describe("versioned session JSON", () => {
  it("uses the measured D10 complete-export warning and failure defaults", () => {
    expect(DEFAULT_SESSION_EXPORT_SIZE_LIMITS).toEqual({
      softByteLimit: 128 * 1024 * 1024,
      hardByteLimit: 256 * 1024 * 1024,
    });
  });

  it("validates against the committed schema and encodes every bigint tick as a decimal string", async () => {
    const value = await session();
    const exported = serializeSessionJson(value);
    if (!exported.ok) throw new Error(exported.error.message);
    const parsed: unknown = JSON.parse(exported.value.content) as unknown;
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(sessionSchema);
    expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true);
    expect(exported.value.content).toContain(
      `"localTimeTicks": "${value.startTime.localTimeTicks.toString()}"`,
    );
    const secondEvent = value.events[1];
    if (secondEvent === undefined) throw new Error("missing retained event");
    expect(exported.value.content).toContain(
      `"relativeTimeTicks": "${secondEvent.relativeTimeTicks.toString()}"`,
    );
    expect(exported.value.content).not.toMatch(
      /"(?:localTimeTicks|relativeTimeTicks|durationTicks)":\s*-?\d/u,
    );
  });

  it("round-trips to a semantically equivalent Session without losing tick precision", async () => {
    const value = await session();
    const exported = serializeSessionJson(value);
    if (!exported.ok) throw new Error(exported.error.message);
    const reparsed = parseSessionJson(exported.value.content);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.value).toEqual(value);
    expect(typeof reparsed.value.startTime.localTimeTicks).toBe("bigint");
    expect(reparsed.value.events[1]?.timestamp.localTimeTicks).toBe(
      value.events[1]?.timestamp.localTimeTicks,
    );
  });

  it("rejects unsupported or malformed documents recoverably", () => {
    expect(parseSessionJson("not json")).toMatchObject({
      ok: false,
      error: { code: "INVALID_SESSION_JSON", recoverable: true },
    });
    expect(parseSessionJson('{"format":"other","version":1}')).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_SESSION_JSON", recoverable: true },
    });
  });
});

describe("WowCoach-compatible encounter log and browser download transport", () => {
  it("wraps selected records in the verified ordered compatibility envelope", async () => {
    const value = await session();
    const combatantInfo = builtCombatantInfo(value.player.guid);
    const exported = serializeEncounterSessionLog(value, { combatantInfo });
    if (!exported.ok) throw new Error(exported.error.message);
    const lines = exported.value.content.trimEnd().split("\n");
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      '8/14/2026 13:30:00.0000  ZONE_CHANGE,469,"Blackwing Lair",9',
    );
    expect(lines[2]).toBe(
      '8/14/2026 13:30:00.0000  MAP_CHANGE,287,"Blackwing Lair",-7394.120117,-7727.069824,-844.622009,-1344.050049',
    );
    expect(lines[3]).toBe(
      '8/14/2026 13:30:01.0001  ENCOUNTER_START,610,"Razorgore the Untamed",9,40,469',
    );
    expect(validateV22CombatantInfo(combatantInfo.eventPayload).ok).toBe(true);
    expect(lines[4]?.split("  ")[1]).toBe(combatantInfo.eventPayload);
    expect(lines.slice(5, 7)).toEqual([TRANSPOSED_DAMAGE, EXTERNAL]);
    expect(lines[7]).toBe(
      '8/14/2026 13:30:02.0000  ENCOUNTER_END,610,"Razorgore the Untamed",9,40,0,1000',
    );
    expect(exported.value.content).not.toContain(NOISE);
    expect(exported.warnings.map((warning) => warning.code)).toEqual([
      "WOWCOACH_SYNTHETIC_ENCOUNTER_ENVELOPE_USED",
      "SIMC_DEFAULTED_COMBATANT_STATS",
      "SIMC_DEFAULTED_COMBATANT_AURAS",
    ]);
    const reparsed = await parseCombatLogChunks([
      new TextEncoder().encode(exported.value.content),
    ]);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.value.records.map((event) => event.type)).toEqual([
      "COMBAT_LOG_VERSION",
      "ZONE_CHANGE",
      "MAP_CHANGE",
      "ENCOUNTER_START",
      "COMBATANT_INFO",
      "SPELL_DAMAGE",
      "SPELL_AURA_APPLIED",
      "ENCOUNTER_END",
    ]);
    expect(reparsed.warnings).toEqual([]);
  });

  it("rewrites advanced map IDs and exports the attempt as a wipe", async () => {
    const value = await session();
    const parsed = await parseCombatLogText(`${HEADER}\n${ADVANCED_DAMAGE}`);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const advancedDamage = parsed.value.records.find(
      (event) => event.type === "SPELL_DAMAGE",
    );
    if (advancedDamage === undefined) {
      throw new Error("missing advanced damage fixture");
    }
    const advancedSession = {
      ...value,
      events: value.events.map((event) =>
        event.raw === DAMAGE ? advancedDamage : event,
      ),
    };
    const exported = serializeEncounterSessionLog(advancedSession, {
      combatantInfo: builtCombatantInfo(value.player.guid),
    });
    if (!exported.ok) throw new Error(exported.error.message);
    const damageLine = exported.value.content
      .split("\n")
      .find((line) => line.includes("  SPELL_DAMAGE,"));
    expect(damageLine).toBeDefined();
    expect(
      damageLine?.match(/Creature-0-1465-469-4188-12435-00007EE8CE/gu),
    ).toHaveLength(2);
    expect(damageLine?.match(/"Razorgore the Untamed"/gu)).toHaveLength(1);
    expect(damageLine).not.toContain("Creature-1");
    expect(damageLine).not.toContain('"Target"');
    expect(damageLine).toContain(",0x10a48,0x0,");
    expect(damageLine).not.toContain('"Razorgore the Untamed",0x10a28,');
    expect(damageLine).toContain(",1.0,2.0,287,0.0,90,");
    expect(damageLine).not.toContain(",2393,");
    expect(exported.value.content).toContain(
      'ENCOUNTER_END,610,"Razorgore the Untamed",9,40,0,1000',
    );
  });

  it("requires supplied character metadata and never substitutes a captured reference character", async () => {
    const value = await session();
    expect(serializeEncounterSessionLog(value)).toMatchObject({
      ok: false,
      error: { code: "SIMC_PROFILE_REQUIRED", recoverable: true },
    });
    expect(createSessionDownload(value, "encounter-log")).toMatchObject({
      ok: false,
      error: { code: "SIMC_PROFILE_REQUIRED", recoverable: true },
    });
    const parsed = await parseCombatLogText(
      `${HEADER}\n${NATURAL_COMBATANT_INFO}`,
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const combatant = parsed.value.records.find(
      (event) => event.type === "COMBATANT_INFO",
    );
    if (combatant === undefined) throw new Error("missing combatant fixture");
    const supplied = builtCombatantInfo(value.player.guid);
    const exported = serializeEncounterSessionLog(
      {
        ...value,
        events: [...value.events, combatant],
      },
      { combatantInfo: supplied },
    );
    if (!exported.ok) throw new Error(exported.error.message);
    expect(exported.value.content).not.toContain(
      "COMBATANT_INFO,Player-1,1,1944",
    );
    expect(exported.value.content).toContain(supplied.eventPayload);
    expect(exported.value.content).not.toContain("Player-3702-0A70D8DF");
  });

  it("changing validated profile metadata changes only the one synthetic COMBATANT_INFO line", async () => {
    const value = await session();
    const first = serializeEncounterSessionLog(value, {
      combatantInfo: builtCombatantInfo(value.player.guid),
    });
    const second = serializeEncounterSessionLog(value, {
      combatantInfo: builtCombatantInfo(value.player.guid, "0"),
    });
    if (!first.ok || !second.ok) throw new Error("export failed");
    const firstLines = first.value.content.trimEnd().split("\n");
    const secondLines = second.value.content.trimEnd().split("\n");
    expect(secondLines[4]).toContain("COMBATANT_INFO,Player-1,0,");
    expect(
      secondLines.filter((line) => line.includes("  COMBATANT_INFO,")),
    ).toHaveLength(1);
    expect(secondLines.filter((_, index) => index !== 4)).toEqual(
      firstLines.filter((_, index) => index !== 4),
    );
    expect(second.warnings.map((warning) => warning.code)).toEqual([
      "WOWCOACH_SYNTHETIC_ENCOUNTER_ENVELOPE_USED",
      "SIMC_DEFAULTED_COMBATANT_STATS",
      "SIMC_DEFAULTED_COMBATANT_AURAS",
    ]);
  });

  it("rejects profile metadata bound to a different player before export", async () => {
    const value = await session();
    expect(
      serializeEncounterSessionLog(value, {
        combatantInfo: builtCombatantInfo("Player-Other"),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMC_CHARACTER_MISMATCH", recoverable: true },
    });
  });

  it("generates deterministic safe filenames and confines Blob creation to browser transport", async () => {
    const value = await session();
    expect(sessionExportFilename(value, "json")).toBe(
      "p-lsefatter-examplerealm-20260814-133001.session.json",
    );
    expect(sessionExportFilename(value, "encounter-log")).toBe(
      "p-lsefatter-examplerealm-20260814-133001.session.encounter.txt",
    );
    const first = createSessionDownload(value, "json");
    const second = createSessionDownload(value, "json");
    if (!first.ok || !second.ok) throw new Error("download creation failed");
    expect(first.value.filename).toBe(second.value.filename);
    expect(first.value.filename).toMatch(/^[a-z0-9.-]+$/u);
    expect(first.value.blob).toBeInstanceOf(Blob);
    expect(await first.value.blob.text()).toBe(await second.value.blob.text());
  });

  it("warns at soft export limits and fails recoverably at hard limits without truncation", async () => {
    const value = await session();
    const baseline = serializeSessionJson(value);
    const soft = serializeSessionJson(value, {
      sizeLimits: { softByteLimit: 1 },
    });
    expect(soft).toMatchObject({
      ok: true,
      warnings: [{ code: "EXPORT_SOFT_BYTE_LIMIT_EXCEEDED" }],
    });
    if (baseline.ok && soft.ok) {
      expect(soft.value.content).toBe(baseline.value.content);
    }
    expect(
      serializeEncounterSessionLog(value, {
        combatantInfo: builtCombatantInfo(value.player.guid),
        sizeLimits: { hardByteLimit: 1 },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        category: "session-too-large",
        code: "EXPORT_HARD_BYTE_LIMIT_EXCEEDED",
        recoverable: true,
      },
    });
  });
});
