import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_EXTRACTION_BUDGETS,
  DEFAULT_SESSION_EXTRACTION_OPTIONS,
  extractSessionChunks,
  extractSessionText,
  parseTimestamp,
  type Session,
  type SessionSelection,
} from "../src/core";

const HEADER =
  "8/14/2026 13:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const PLAYER = 'Player-1,"Téstknight-ExampleRealm",0x511,0x0';
const OTHER = 'Player-2,"Nearby-ExampleRealm",0x518,0x0';
const TARGET_A = 'Creature-Target-A,"Localized Target",0xa28,0x0';
const TARGET_B = 'Creature-Target-B,"Second Target",0xa28,0x0';
const OTHER_TARGET = 'Creature-Other,"Other Creature",0xa28,0x0';
const PET = 'Pet-1,"Companion",0x2111,0x0';
const GUARDIAN = 'Guardian-1,"Guardian",0xa28,0x0';
const SUMMON = 'Creature-Summon,"Same Name",0xa28,0x0';
const SAME_NAME_ONLY = 'Creature-Unowned,"Same Name",0xa28,0x0';
const EXPLICIT = 'Guardian-Explicit,"Advanced Guardian",0xa28,0x0';
const CONFLICT = 'Guardian-Conflict,"Conflicted Guardian",0x2111,0x0';
const ZERO = "0000000000000000,nil,0x80000000,0x0";

function time(second: number): string {
  return `8/14/2026 13:00:${String(second).padStart(2, "0")}.0000`;
}

function record(second: number, type: string, payload: string): string {
  return `${time(second)}  ${type},${payload}`;
}

function damage(
  second: number,
  source: string,
  destination: string,
  tail = "100",
): string {
  return record(
    second,
    "SPELL_DAMAGE",
    `${source},${destination},1,"Strike",0x1,${tail}`,
  );
}

function swing(
  second: number,
  source: string,
  destination: string,
  advancedOwnerGuid: string,
): string {
  const sourceGuid = source.slice(0, source.indexOf(","));
  return record(
    second,
    "SWING_DAMAGE",
    `${source},${destination},${sourceGuid},${advancedOwnerGuid},1`,
  );
}

function fixtureLines(): readonly string[] {
  return [
    HEADER,
    record(
      4,
      "SPELL_AURA_APPLIED",
      `${PLAYER},${PLAYER},2,"Too Early",0x1,BUFF`,
    ),
    record(
      6,
      "SPELL_AURA_APPLIED",
      `${PLAYER},${PLAYER},3,"Pre State",0x1,BUFF`,
    ),
    record(7, "SPELL_SUMMON", `${PLAYER},${GUARDIAN},4,"Guardian Spell",0x1`),
    record(8, "SPELL_CREATE", `${PLAYER},${SUMMON},5,"Create Spell",0x1`),
    damage(10, PLAYER, TARGET_A),
    damage(11, PLAYER, TARGET_B),
    damage(12, PET, TARGET_A),
    damage(13, GUARDIAN, TARGET_A),
    damage(14, SUMMON, TARGET_B),
    swing(15, EXPLICIT, TARGET_A, "Player-1"),
    swing(16, CONFLICT, TARGET_A, "Player-2"),
    record(
      17,
      "SPELL_AURA_APPLIED",
      `${OTHER},${PLAYER},6,"External Buff",0x1,BUFF`,
    ),
    damage(18, TARGET_A, PLAYER),
    damage(19, OTHER, TARGET_A),
    damage(20, SAME_NAME_ONLY, TARGET_A),
    record(20, "UNIT_DIED", `${ZERO},${TARGET_B}`),
    record(
      24,
      "SPELL_AURA_REMOVED",
      `${PLAYER},${PLAYER},3,"Pre State",0x1,BUFF`,
    ),
    damage(26, PLAYER, TARGET_A),
    damage(40, PLAYER, OTHER_TARGET),
  ];
}

function selection(): SessionSelection {
  const start = parseTimestamp(time(10));
  const end = parseTimestamp(time(20));
  if (!start.ok || !end.ok) throw new Error("fixture timestamps must parse");
  return {
    id: "multi-target-session",
    playerGuid: "Player-1",
    targetGuids: ["Creature-Target-A", "Creature-Target-B"],
    startTime: start.value,
    endTime: end.value,
  };
}

async function extract(
  options: Parameters<typeof extractSessionText>[2] = {},
): Promise<Session> {
  const result = await extractSessionText(
    fixtureLines().join("\n"),
    selection(),
    options,
  );
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("pass-two extraction, ownership, and filtering", () => {
  it("keeps the selected player, complete target set, owned activity, incoming events, and external effects", async () => {
    const session = await extract({ includeDebugDecisions: true });
    expect(session.startTime.raw).toBe(time(10));
    expect(session.endTime.raw).toBe(time(20));
    expect(session.durationTicks).toBe(100_000n);
    expect(session.targets.map((target) => target.guid)).toEqual([
      "Creature-Target-A",
      "Creature-Target-B",
    ]);
    expect(session.focusTargetGuid).toBeUndefined();
    expect(session.statistics.targets).toHaveLength(2);
    expect(
      session.statistics.targets.every(
        (target) => target.relevantEventCount > 0,
      ),
    ).toBe(true);

    const controlled = session.actors
      .filter((actor) => actor.relationship === "owned-by-primary")
      .map((actor) => actor.guid)
      .sort();
    expect(controlled).toEqual([
      "Creature-Summon",
      "Guardian-1",
      "Guardian-Explicit",
      "Pet-1",
    ]);
    expect(session.statistics.controlledEntityCount).toBe(4);
    expect(session.events.some((event) => event.source?.guid === "Pet-1")).toBe(
      true,
    );
    expect(
      session.events.some(
        (event) => event.source?.guid === "Guardian-Explicit",
      ),
    ).toBe(true);
    expect(
      session.events.find((event) => event.spell?.name === "External Buff"),
    ).toMatchObject({ externalEffect: true });
    expect(session.statistics.externalEffectCount).toBe(1);
  });

  it.each([
    ["Pet-1", "affiliation-mine"],
    ["Guardian-1", "summon"],
    ["Creature-Summon", "create"],
    ["Guardian-Explicit", "advanced-owner-guid"],
  ] as const)("resolves %s using %s evidence", async (guid, evidence) => {
    const session = await extract();
    const actor = session.actors.find((candidate) => candidate.guid === guid);
    expect(actor?.ownerGuid).toBe("Player-1");
    expect(actor?.ownershipEvidence).toContain(evidence);
  });

  it("lets explicit owner evidence override mine evidence, reports both sources, and never owns by name", async () => {
    const session = await extract({ includeDebugDecisions: true });
    expect(
      session.actors.some((actor) => actor.guid === "Guardian-Conflict"),
    ).toBe(false);
    expect(
      session.actors.some((actor) => actor.guid === "Creature-Unowned"),
    ).toBe(false);
    const warning = session.warnings.find(
      (candidate) => candidate.code === "OWNERSHIP_CONFLICT",
    );
    expect(warning?.context?.details).toMatchObject({
      entityGuid: "Guardian-Conflict",
      winningEvidence: {
        ownerGuid: "Player-2",
        evidence: "advanced-owner-guid",
      },
      conflictingEvidence: {
        ownerGuid: "Player-1",
        evidence: "affiliation-mine",
      },
    });
    expect(
      session.debugDecisions?.find(
        (decision) => decision.sourceGuid === "Creature-Unowned",
      ),
    ).toMatchObject({ decision: "removed" });
  });

  it("removes unrelated nearby actors and accounts for every considered record", async () => {
    const session = await extract({ includeDebugDecisions: true });
    expect(
      session.events.some((event) => event.source?.guid === "Player-2"),
    ).toBe(true);
    expect(
      session.events.some(
        (event) =>
          event.source?.guid === "Player-2" &&
          event.destination?.guid === "Creature-Target-A",
      ),
    ).toBe(false);
    const audit = session.statistics.filtering;
    expect(audit.consideredRecordCount).toBe(
      audit.keptRecordCount + audit.removedRecordCount,
    );
    expect(audit.keptRecordCount).toBe(session.events.length);
    expect(audit.removedRecordCount).toBe(session.statistics.removedEventCount);
    expect(session.debugDecisions).toHaveLength(audit.consideredRecordCount);
  });

  it(`uses the ${String(DEFAULT_SESSION_EXTRACTION_OPTIONS.preRollMs)} ms pre-roll and post-roll without changing visible boundaries`, async () => {
    const session = await extract();
    expect(
      session.events.some((event) => event.timestamp.raw === time(4)),
    ).toBe(false);
    expect(
      session.events.some((event) => event.timestamp.raw === time(6)),
    ).toBe(true);
    expect(
      session.events.some((event) => event.timestamp.raw === time(24)),
    ).toBe(true);
    expect(
      session.events.some((event) => event.timestamp.raw === time(26)),
    ).toBe(false);
    expect(session.events.some((event) => event.relativeTimeTicks < 0n)).toBe(
      true,
    );
    expect(session.endTime.raw).toBe(time(20));

    const withoutRoll = await extract({ preRollMs: 0, postRollMs: 0 });
    expect(
      withoutRoll.events.some((event) => event.timestamp.raw === time(6)),
    ).toBe(false);
    expect(
      withoutRoll.events.some((event) => event.timestamp.raw === time(24)),
    ).toBe(false);
  });

  it("stops consuming byte chunks after post-roll", async () => {
    const lines = fixtureLines();
    const chunks = lines.map((line) => new TextEncoder().encode(`${line}\n`));
    let yielded = 0;
    function* source() {
      for (const chunk of chunks) {
        yielded += 1;
        yield chunk;
      }
    }
    const result = await extractSessionChunks(
      source(),
      {
        name: "incremental.log",
        sizeBytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      },
      selection(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.statistics.filtering.stoppedAfterPostRoll).toBe(true);
    expect(yielded).toBeLessThan(chunks.length);
    expect(result.value.statistics.filtering.bytesRead).toBe(
      chunks
        .slice(0, yielded)
        .reduce((sum, chunk) => sum + chunk.byteLength, 0),
    );
  });
});

describe("retained-data budgets and cancellation", () => {
  it("uses the measured D10 retained-event and retained-source-byte defaults", () => {
    expect(DEFAULT_SESSION_EXTRACTION_BUDGETS).toEqual({
      softRetainedEventLimit: 25_000,
      hardRetainedEventLimit: 50_000,
      softEstimatedByteLimit: 16 * 1024 * 1024,
      hardEstimatedByteLimit: 32 * 1024 * 1024,
    });
  });

  it("warns at soft event and byte limits and returns the complete session", async () => {
    const baseline = await extract();
    const warned = await extract({
      budgets: {
        softRetainedEventLimit: 1,
        softEstimatedByteLimit: 1,
      },
    });
    expect(warned.events).toHaveLength(baseline.events.length);
    expect(warned.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "SESSION_SOFT_EVENT_LIMIT_EXCEEDED",
        "SESSION_SOFT_BYTE_LIMIT_EXCEEDED",
      ]),
    );
  });

  it.each([
    [{ hardRetainedEventLimit: 1 }, "SESSION_HARD_EVENT_LIMIT_EXCEEDED"],
    [{ hardEstimatedByteLimit: 1 }, "SESSION_HARD_BYTE_LIMIT_EXCEEDED"],
  ] as const)(
    "fails recoverably instead of truncating at %s",
    async (budgets, code) => {
      const result = await extractSessionText(
        fixtureLines().join("\n"),
        selection(),
        {
          budgets,
        },
      );
      expect(result).toMatchObject({
        ok: false,
        error: { category: "session-too-large", code, recoverable: true },
      });
    },
  );

  it("cancels cooperatively without returning a partial Session", async () => {
    let checks = 0;
    const result = await extractSessionText(
      fixtureLines().join("\n"),
      selection(),
      {
        shouldAbort: () => {
          checks += 1;
          return checks > 8;
        },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { category: "cancelled", code: "OPERATION_CANCELLED" },
    });
  });
});
