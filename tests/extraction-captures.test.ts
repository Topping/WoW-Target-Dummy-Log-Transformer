import { createReadStream } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  extractSessionChunks,
  parseTimestamp,
  type NonEmptyReadonlyArray,
  type Session,
  type SessionSelection,
} from "../src/core";

const PLAYER_GUID = "Player-3702-0A70D8DF";

function selected(
  id: string,
  startRaw: string,
  endRaw: string,
  targetGuids: NonEmptyReadonlyArray<string>,
): SessionSelection {
  const start = parseTimestamp(startRaw);
  const end = parseTimestamp(endRaw);
  if (!start.ok || !end.ok) throw new Error("approved timestamps must parse");
  return {
    id,
    playerGuid: PLAYER_GUID,
    targetGuids,
    startTime: start.value,
    endTime: end.value,
  };
}

async function extractCapture(
  path: string,
  sizeBytes: number,
  selection: SessionSelection,
): Promise<Session> {
  const result = await extractSessionChunks(
    createReadStream(path),
    { name: path.split("/").at(-1) ?? path, sizeBytes },
    selection,
  );
  if (!result.ok)
    throw new Error(`${path}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("capture-wide pass-two ground truth", () => {
  it(
    "extracts the approved noisy single-target window with all three affiliated Risen Ghouls",
    { timeout: 120_000 },
    async () => {
      const targetGuid = "Creature-0-3890-0-78-243168-00007E6EA6";
      const session = await extractCapture(
        "data/dummy-encounter.txt",
        28_880_428,
        selected(
          "approved-dummy-window",
          "8/14/2026 11:47:38.3082",
          "8/14/2026 11:51:36.5472",
          [targetGuid],
        ),
      );
      expect(session.player.name).toBe("Pølsefatter-ArgentDawn-EU");
      expect(session.targets.map((target) => target.guid)).toEqual([
        targetGuid,
      ]);
      expect(session.focusTargetGuid).toBe(targetGuid);
      expect(
        session.actors
          .filter(
            (actor) =>
              actor.relationship === "owned-by-primary" &&
              actor.name === "Risen Ghoul",
          )
          .map((actor) => actor.guid)
          .sort(),
      ).toEqual([
        "Creature-0-3890-0-78-26125-00007EE43B",
        "Creature-0-3890-0-78-26125-00007EE495",
        "Creature-0-3890-0-78-26125-00007EE4EF",
      ]);
      expect(session.statistics.filtering.removedRecordCount).toBeGreaterThan(
        0,
      );
      expect(session.statistics.externalEffectCount).toBe(
        session.events.filter((event) => event.externalEffect === true).length,
      );
      expect(session.statistics.filtering.bytesRead).toBeLessThan(28_880_428);
      expect(
        session.events.some((event) => event.additionalFields.length > 0),
      ).toBe(true);
      expect(
        session.events.every(
          (event, index, events) =>
            index === 0 ||
            (events[index - 1]?.location.lineNumber ?? 0) <
              event.location.lineNumber,
        ),
      ).toBe(true);
    },
  );

  it(
    "extracts the continuous 87.413-second cleave attempt with all five approved targets",
    { timeout: 120_000 },
    async () => {
      const targets = [
        "Creature-0-1469-0-1615-243208-00007ED3AB",
        "Creature-0-1469-0-1615-243208-0000FED3AB",
        "Creature-0-1469-0-1615-243208-00017ED3AB",
        "Creature-0-1469-0-1615-243208-0001FED3AB",
        "Creature-0-1469-0-1615-243208-00027ED3AB",
      ] as const;
      const session = await extractCapture(
        "data/cleave-logs.txt",
        2_290_979,
        selected(
          "approved-cleave-window",
          "8/14/2026 12:46:23.3732",
          "8/14/2026 12:47:50.7862",
          targets,
        ),
      );
      expect(session.durationTicks).toBe(874_130n);
      expect(new Set(session.targets.map((target) => target.guid))).toEqual(
        new Set(targets),
      );
      expect(session.focusTargetGuid).toBeUndefined();
      expect(session.statistics.targets).toHaveLength(5);
      expect(
        session.statistics.targets.every(
          (target) => target.outgoingEventCount > 0,
        ),
      ).toBe(true);
      expect(session.statistics.filtering.consideredRecordCount).toBe(
        session.statistics.filtering.keptRecordCount +
          session.statistics.filtering.removedRecordCount,
      );
    },
  );

  it(
    "extracts one approved split group without leaking interactions from adjacent groups",
    { timeout: 120_000 },
    async () => {
      const targetGuid = "Creature-0-1469-0-1615-243167-00007ED3AB";
      const session = await extractCapture(
        "data/session-splitting.txt",
        1_406_938,
        selected(
          "approved-split-group-2",
          "8/14/2026 12:49:24.3302",
          "8/14/2026 12:49:27.5752",
          [targetGuid],
        ),
      );
      const selectedInteractions = session.events.filter(
        (event) =>
          event.source?.guid === PLAYER_GUID &&
          event.destination?.guid === targetGuid,
      );
      expect(selectedInteractions.length).toBeGreaterThan(0);
      expect(
        selectedInteractions.every(
          (event) =>
            event.timestamp.localTimeTicks >=
              session.startTime.localTimeTicks &&
            event.timestamp.localTimeTicks <= session.endTime.localTimeTicks,
        ),
      ).toBe(true);
    },
  );

  it(
    "preserves natural second boss-envelope metadata and its corrected success value",
    { timeout: 120_000 },
    async () => {
      const targetGuid = "Creature-0-1465-469-4188-12435-00007EE8CE";
      const session = await extractCapture(
        "data/boss-encounter.txt",
        47_102,
        selected(
          "approved-second-boss-envelope",
          "8/14/2026 12:09:57.5792",
          "8/14/2026 12:09:58.7942",
          [targetGuid],
        ),
      );
      const starts = session.events.filter(
        (event) => event.type === "ENCOUNTER_START",
      );
      const ends = session.events.filter(
        (event) => event.type === "ENCOUNTER_END",
      );
      const combatants = session.events.filter(
        (event) => event.type === "COMBATANT_INFO",
      );
      expect(starts).toHaveLength(1);
      expect(ends).toHaveLength(1);
      expect(combatants).toHaveLength(1);
      expect(ends[0]?.payload).toMatchObject({
        encounterId: 610,
        encounterName: "Razorgore the Untamed",
        success: true,
      });
      expect(ends[0]?.raw).toContain(
        'ENCOUNTER_END,610,"Razorgore the Untamed",9,40,1,1209',
      );
    },
  );
});
