import { describe, expect, it } from "vitest";

import {
  CombatLogSchemaRegistry,
  DEFAULT_SESSION_DISCOVERY_OPTIONS,
  defaultSchemaRegistry,
  discoverCombatLogText,
  type CombatLogSchema,
  type DiscoveryResult,
} from "../src/core";

const HEADER =
  "8/14/2026 14:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const MINE = 'Player-1,"Recorder-Realm",0x511,0x0';
const OTHER = 'Player-2,"Nearby-Realm",0x518,0x0';
const TARGET_A = 'Creature-1,"Localized Target",0xa28,0x0';
const TARGET_B = 'Creature-2,"Second Target",0xa28,0x0';
const ZERO = "0000000000000000,nil,0x80000000,0x0";

function timestamp(seconds: number): string {
  const whole = Math.floor(seconds).toString().padStart(2, "0");
  return `8/14/2026 14:00:${whole}.0000`;
}

function record(seconds: number, type: string, payload: string): string {
  return `${timestamp(seconds)}  ${type},${payload}`;
}

function damage(
  seconds: number,
  source = MINE,
  target = TARGET_A,
  type = "SPELL_DAMAGE",
): string {
  return record(seconds, type, `${source},${target},1,"Strike",0x1,100`);
}

function cast(seconds: number, source = MINE, target = TARGET_A): string {
  return record(
    seconds,
    "SPELL_CAST_SUCCESS",
    `${source},${target},1,"Strike",0x1`,
  );
}

async function discover(
  lines: readonly string[],
  options: Parameters<typeof discoverCombatLogText>[2] = {},
): Promise<DiscoveryResult> {
  const result = await discoverCombatLogText(
    [HEADER, ...lines].join("\n"),
    undefined,
    options,
  );
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("bounded pass-one actor and recorder discovery", () => {
  it("deduplicates every player, ranks activity, and proposes only one mine player", async () => {
    const result = await discover([
      cast(1),
      damage(2),
      damage(3),
      cast(4, OTHER, TARGET_B),
      record(5, "COMBATANT_INFO", "Player-3,1,2,3"),
    ]);
    expect(result.players.map((player) => player.guid).sort()).toEqual([
      "Player-1",
      "Player-2",
      "Player-3",
    ]);
    expect(result.players[0]).toMatchObject({
      guid: "Player-1",
      recorderCandidate: true,
      outgoingCastCount: 1,
      outgoingDamageCount: 2,
      targetInteractionCount: 1,
    });
    expect(result.proposedRecorderGuid).toBe("Player-1");
  });

  it("never constructs full normalized CombatEvent values during discovery", async () => {
    const base = defaultSchemaRegistry.list()[0];
    if (base === undefined) throw new Error("A default schema is required.");
    let normalizationCalls = 0;
    const instrumented: CombatLogSchema = {
      ...base,
      id: "discovery-normalization-spy",
      normalize: (rawRecord, context) => {
        normalizationCalls += 1;
        return base.normalize(rawRecord, context);
      },
    };
    const registry = new CombatLogSchemaRegistry([instrumented]);
    const result = await discover([damage(1), damage(2)], {
      registry,
      manualSchemaId: instrumented.id,
    });

    expect(result.recordsScanned).toBe(3);
    expect(normalizationCalls).toBe(0);
    expect(result.retainedState).toMatchObject({
      retainedCombatEventCount: 0,
      retainedRawLineCount: 0,
    });
  });

  it("requires explicit selection when zero or multiple player actors are mine", async () => {
    const noMine = await discover([damage(1, OTHER)]);
    expect(noMine.proposedRecorderGuid).toBeUndefined();

    const secondMine = 'Player-2,"Second Recorder",0x511,0x0';
    const multiple = await discover([damage(1), damage(2, secondMine)]);
    expect(
      multiple.players.filter((player) => player.recorderCandidate),
    ).toHaveLength(2);
    expect(multiple.proposedRecorderGuid).toBeUndefined();
  });

  it("retains aggregate counters but no CombatEvent objects or raw source lines", async () => {
    const lines = Array.from({ length: 200 }, (_, index) =>
      damage((index % 50) + 1),
    );
    const result = await discover(lines);
    expect(result.recordsScanned).toBe(201);
    expect(result.retainedState).toMatchObject({
      actorCount: 2,
      targetCount: 1,
      retainedCombatEventCount: 0,
      retainedRawLineCount: 0,
    });
    expect(result.retainedState.candidateWindowCount).toBeLessThan(10);
    expect(result).not.toHaveProperty("records");
  });
});

describe("target ranking and qualifying activity", () => {
  it("ranks sustained creature interactions without depending on an English dummy name", async () => {
    const result = await discover([
      damage(1, MINE, TARGET_B),
      damage(2, MINE, TARGET_A),
      damage(3, MINE, TARGET_A),
      damage(4, MINE, TARGET_A),
    ]);
    expect(result.targets[0]).toMatchObject({
      guid: "Creature-1",
      name: "Localized Target",
      interactionCount: 3,
      interactingPlayerCount: 1,
    });
  });

  it("does not let self-buffs, resources, heals, failed casts, or incoming noise bridge sessions", async () => {
    const lines = [
      damage(1),
      record(8, "SPELL_AURA_APPLIED", `${MINE},${MINE},2,"Buff",0x1,BUFF`),
      record(9, "SPELL_ENERGIZE", `${MINE},${MINE},3,"Power",0x1,10`),
      record(10, "SPELL_HEAL", `${MINE},${MINE},4,"Heal",0x1,10`),
      record(11, "SPELL_CAST_FAILED", `${MINE},${TARGET_A},5,"Fail",0x1,Miss`),
      record(
        12,
        "SPELL_AURA_APPLIED",
        `${OTHER},${MINE},6,"External",0x1,BUFF`,
      ),
      damage(19),
    ];
    const result = await discover(lines);
    expect(
      result.sessions.filter((session) => session.playerGuid === "Player-1"),
    ).toHaveLength(2);
  });

  it("lets periodic activity extend intent but not independently establish it", async () => {
    const extended = await discover([
      damage(1),
      damage(9, MINE, TARGET_A, "SPELL_PERIODIC_DAMAGE"),
      damage(18),
    ]);
    expect(extended.sessions).toHaveLength(1);
    expect(extended.sessions[0]?.endTime.raw).toBe(timestamp(18));

    const hidden = await discover([
      damage(1, MINE, TARGET_A, "SPELL_PERIODIC_DAMAGE"),
    ]);
    expect(hidden.sessions).toEqual([]);
    const advanced = await discover(
      [damage(1, MINE, TARGET_A, "SPELL_PERIODIC_DAMAGE")],
      { includeIncidental: true },
    );
    expect(advanced.sessions[0]?.confidence).toBe("incidental");
  });
});

describe("session boundaries, options, confidence, and target sets", () => {
  it(`defaults inactivity to ${String(DEFAULT_SESSION_DISCOVERY_OPTIONS.inactivityThresholdMs)} ms and consumes overrides`, async () => {
    const lines = [damage(1), damage(9)];
    expect((await discover(lines)).sessions).toHaveLength(1);
    expect(
      (await discover(lines, { inactivityThresholdMs: 5_000 })).sessions,
    ).toHaveLength(2);
  });

  it.each(["ZONE_CHANGE", "MAP_CHANGE"])(
    "treats %s as a hard boundary",
    async (boundary) => {
      const result = await discover([
        damage(1),
        record(2, boundary, '1,"Somewhere",0'),
        damage(3),
      ]);
      expect(result.sessions).toHaveLength(2);
    },
  );

  it("treats target death and backwards timestamps as hard boundaries", async () => {
    const death = await discover([
      damage(1),
      record(2, "UNIT_DIED", `${ZERO},${TARGET_A}`),
      damage(3),
    ]);
    expect(death.sessions).toHaveLength(2);

    const backwards = await discover([damage(5), damage(4)]);
    expect(backwards.sessions).toHaveLength(2);
  });

  it("collects every target in one continuous cleave window", async () => {
    const result = await discover([
      damage(1, MINE, TARGET_A),
      damage(2, MINE, TARGET_B),
      damage(3, MINE, TARGET_A),
    ]);
    expect(result.sessions[0]?.targetGuids).toEqual([
      "Creature-1",
      "Creature-2",
    ]);
    expect(result.sessions[0]?.reasons.map((reason) => reason.code)).toContain(
      "MULTI_TARGET",
    );
  });

  it("assigns configurable likely and possible tiers with reason codes", async () => {
    const possible = await discover([damage(1)]);
    expect(possible.sessions[0]).toMatchObject({ confidence: "possible" });
    expect(
      possible.sessions[0]?.reasons.map((reason) => reason.code),
    ).toContain("SHORT_DURATION");

    const likely = await discover([damage(1), damage(11), damage(21)]);
    expect(likely.sessions[0]).toMatchObject({ confidence: "likely" });
    expect(likely.sessions[0]?.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "MULTIPLE_PLAYER_ACTIONS",
        "MINIMUM_DURATION_MET",
        "SUSTAINED_ACTIVITY",
      ]),
    );
  });

  it("retains encounter envelopes and excludes actions inside them from normal sessions", async () => {
    const result = await discover([
      record(1, "ENCOUNTER_START", '610,"Boss",9,40,469'),
      damage(2),
      record(3, "ENCOUNTER_END", '610,"Boss",9,40,1,2000'),
    ]);
    expect(result.encounterEnvelopes).toHaveLength(1);
    expect(result.encounterEnvelopes[0]?.encounterId).toBe(610);
    expect(result.encounterEnvelopes[0]?.name).toBe("Boss");
    expect(result.encounterEnvelopes[0]?.success).toBe(true);
    expect(result.encounterEnvelopes[0]?.startTime.raw).toBe(timestamp(1));
    expect(result.encounterEnvelopes[0]?.endTime?.raw).toBe(timestamp(3));
    expect(result.sessions).toEqual([]);
    expect(result.targets).toEqual([]);
  });

  it("does not discard an earlier completed training window outside encounter lead-in", async () => {
    const result = await discover([
      damage(1),
      record(2, "UNIT_DIED", `${ZERO},${TARGET_A}`),
      record(20, "ENCOUNTER_START", '610,"Boss",9,40,469'),
      record(21, "ENCOUNTER_END", '610,"Boss",9,40,0,1000'),
    ]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.startTime.raw).toBe(timestamp(1));
    expect(result.encounterEnvelopes).toHaveLength(1);
  });
});
