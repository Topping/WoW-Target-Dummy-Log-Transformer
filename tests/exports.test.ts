import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import sessionSchema from "../docs/session.schema.json";
import {
  DEFAULT_SESSION_EXPORT_SIZE_LIMITS,
  extractSessionText,
  parseCombatLogChunks,
  parseSessionJson,
  parseTimestamp,
  serializeFilteredSessionLog,
  serializeSessionJson,
  sessionExportFilename,
  type Session,
  type SessionSelection,
} from "../src/core";
import { createSessionDownload } from "../src/worker";

const HEADER =
  "8/14/2026 13:30:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const DAMAGE =
  '8/14/2026 13:30:01.0001  SPELL_DAMAGE,Player-1,"Pølsefatter-ExampleRealm",0x511,0x0,Creature-1,"Target",0xa28,0x0,1,"Strike",0x1,100';
const NOISE =
  '8/14/2026 13:30:01.5000  SPELL_DAMAGE,Player-2,"Nearby",0x518,0x0,Creature-2,"Other",0xa28,0x0,2,"Noise",0x1,50';
const EXTERNAL =
  '8/14/2026 13:30:02.0000  SPELL_AURA_APPLIED,Player-2,"Nearby",0x518,0x0,Player-1,"Pølsefatter-ExampleRealm",0x511,0x0,3,"External",0x1,BUFF';
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

describe("filtered raw log and browser download transport", () => {
  it("preserves retained source lines and their original line endings byte-for-byte", async () => {
    const value = await session();
    const exported = serializeFilteredSessionLog(value);
    if (!exported.ok) throw new Error(exported.error.message);
    expect(exported.value.content).toBe(`${HEADER}\r\n${DAMAGE}\n${EXTERNAL}`);
    expect(new TextEncoder().encode(exported.value.content)).toEqual(
      new TextEncoder().encode(`${HEADER}\r\n${DAMAGE}\n${EXTERNAL}`),
    );
    const reparsed = await parseCombatLogChunks([
      new TextEncoder().encode(exported.value.content),
    ]);
    expect(reparsed.ok).toBe(true);
  });

  it("generates deterministic safe filenames and confines Blob creation to browser transport", async () => {
    const value = await session();
    expect(sessionExportFilename(value, "json")).toBe(
      "p-lsefatter-examplerealm-20260814-133001.session.json",
    );
    expect(sessionExportFilename(value, "filtered-log")).toBe(
      "p-lsefatter-examplerealm-20260814-133001.session.filtered.log",
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
      serializeFilteredSessionLog(value, {
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
