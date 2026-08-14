import { createReadStream } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "../../data/fixtures.manifest.json";
import {
  discoverCombatLogChunks,
  extractSessionChunks,
  parseTimestamp,
  serializeEncounterSessionLog,
  serializeSessionJson,
  type NonEmptyReadonlyArray,
  type SessionSelection,
} from "../../src/core";

interface Timing {
  readonly wallMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
}

interface ProfileMeasurement {
  readonly fixture: string;
  readonly pass: "discovery" | "extraction";
  readonly sourceBytes: number;
  readonly recordsScanned?: number;
  readonly retainedStateCount?: number;
  readonly retainedActors?: number;
  readonly retainedTargets?: number;
  readonly retainedCandidateWindows?: number;
  readonly retainedOwnedEntities?: number;
  readonly retainedEncounterEnvelopes?: number;
  readonly retainedEvents?: number;
  readonly reconstructionWindowRecords?: number;
  readonly retainedSourceBytes?: number;
  readonly bytesRead: number;
  readonly stoppedAfterPostRoll?: boolean;
  readonly jsonExportBytes?: number;
  readonly encounterLogExportBytes?: number;
  readonly timing: Timing;
}

const PLAYER_GUID = "Player-3702-0A70D8DF";

function capture(id: string) {
  const value = manifest.captures.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error(`Missing capture '${id}'.`);
  return value;
}

function selection(
  id: string,
  startRaw: string,
  endRaw: string,
  targetGuids: NonEmptyReadonlyArray<string>,
): SessionSelection {
  const start = parseTimestamp(startRaw);
  const end = parseTimestamp(endRaw);
  if (!start.ok || !end.ok) throw new Error("Approved timestamps must parse.");
  return {
    id,
    playerGuid: PLAYER_GUID,
    targetGuids,
    startTime: start.value,
    endTime: end.value,
  };
}

async function timed<T>(operation: () => Promise<T>): Promise<{
  readonly value: T;
  readonly timing: Timing;
}> {
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const value = await operation();
  const cpu = process.cpuUsage(cpuStart);
  return {
    value,
    timing: {
      wallMs: performance.now() - wallStart,
      cpuUserMs: cpu.user / 1_000,
      cpuSystemMs: cpu.system / 1_000,
    },
  };
}

function report(measurement: ProfileMeasurement): void {
  if (process.env["D10_PROFILE"] === "1") {
    process.stdout.write(`${JSON.stringify(measurement)}\n`);
  }
}

describe("D10 capture-wide performance and retention profile", () => {
  it(
    "profiles pass-one state on the noisy and cleave real captures",
    { timeout: 120_000 },
    async () => {
      for (const captureId of ["cleave-logs", "dummy-encounter"] as const) {
        const fixture = capture(captureId);
        let bytesRead = 0;
        const measured = await timed(() =>
          discoverCombatLogChunks(
            createReadStream(fixture.path),
            {
              name: fixture.path.split("/").at(-1) ?? fixture.path,
              sizeBytes: fixture.observed.bytes,
            },
            {
              onBytesProcessed: (value) => {
                bytesRead = value;
              },
            },
          ),
        );
        expect(measured.value.ok, fixture.path).toBe(true);
        if (!measured.value.ok) continue;
        const retained = measured.value.value.retainedState;
        const retainedStateCount =
          retained.actorCount +
          retained.targetCount +
          retained.candidateWindowCount +
          retained.ownedEntityCount +
          retained.encounterEnvelopeCount;

        expect(bytesRead).toBe(fixture.observed.bytes);
        expect(retained.retainedCombatEventCount).toBe(0);
        expect(retained.retainedRawLineCount).toBe(0);
        expect(retainedStateCount).toBeLessThan(
          measured.value.value.recordsScanned / 10,
        );
        report({
          fixture: fixture.path,
          pass: "discovery",
          sourceBytes: fixture.observed.bytes,
          recordsScanned: measured.value.value.recordsScanned,
          retainedStateCount,
          retainedActors: retained.actorCount,
          retainedTargets: retained.targetCount,
          retainedCandidateWindows: retained.candidateWindowCount,
          retainedOwnedEntities: retained.ownedEntityCount,
          retainedEncounterEnvelopes: retained.encounterEnvelopeCount,
          retainedEvents: retained.retainedCombatEventCount,
          bytesRead,
          timing: measured.timing,
        });
      }
    },
  );

  it(
    "profiles selected-window extraction, early stopping, and export sizes",
    { timeout: 120_000 },
    async () => {
      const cases = [
        {
          fixture: capture("dummy-encounter"),
          selected: selection(
            "approved-dummy-window",
            "8/14/2026 11:47:38.3082",
            "8/14/2026 11:51:36.5472",
            ["Creature-0-3890-0-78-243168-00007E6EA6"],
          ),
        },
        {
          fixture: capture("cleave-logs"),
          selected: selection(
            "approved-cleave-window",
            "8/14/2026 12:46:23.3732",
            "8/14/2026 12:47:50.7862",
            [
              "Creature-0-1469-0-1615-243208-00007ED3AB",
              "Creature-0-1469-0-1615-243208-0000FED3AB",
              "Creature-0-1469-0-1615-243208-00017ED3AB",
              "Creature-0-1469-0-1615-243208-0001FED3AB",
              "Creature-0-1469-0-1615-243208-00027ED3AB",
            ],
          ),
        },
      ] as const;

      for (const item of cases) {
        const measured = await timed(() =>
          extractSessionChunks(
            createReadStream(item.fixture.path),
            {
              name: item.fixture.path.split("/").at(-1) ?? item.fixture.path,
              sizeBytes: item.fixture.observed.bytes,
            },
            item.selected,
          ),
        );
        expect(measured.value.ok, item.fixture.path).toBe(true);
        if (!measured.value.ok) continue;
        const session = measured.value.value;
        const json = serializeSessionJson(session);
        const encounter = serializeEncounterSessionLog(session);
        expect(json.ok).toBe(true);
        expect(encounter.ok).toBe(true);
        if (!json.ok || !encounter.ok) continue;

        expect(session.statistics.filtering.stoppedAfterPostRoll).toBe(true);
        expect(session.statistics.filtering.bytesRead).toBeLessThan(
          item.fixture.observed.bytes,
        );
        expect(session.statistics.filtering.consideredRecordCount).toBeLessThan(
          item.fixture.observed.records,
        );
        expect(session.events.length).toBe(
          session.statistics.filtering.keptRecordCount,
        );
        report({
          fixture: item.fixture.path,
          pass: "extraction",
          sourceBytes: item.fixture.observed.bytes,
          retainedEvents: session.events.length,
          reconstructionWindowRecords:
            session.statistics.filtering.consideredRecordCount,
          retainedSourceBytes:
            session.statistics.filtering.estimatedRetainedBytes,
          bytesRead: session.statistics.filtering.bytesRead,
          stoppedAfterPostRoll:
            session.statistics.filtering.stoppedAfterPostRoll,
          jsonExportBytes: json.value.byteLength,
          encounterLogExportBytes: encounter.value.byteLength,
          timing: measured.timing,
        });
      }
    },
  );
});
