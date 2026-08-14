import { createReadStream } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "../data/fixtures.manifest.json";
import { discoverCombatLogChunks } from "../src/core";

describe("capture-wide discovery ground truth", () => {
  it(
    "validates players, recorder, attempts, encounters, and owned observations",
    { timeout: 120_000 },
    async () => {
      for (const capture of manifest.captures) {
        const result = await discoverCombatLogChunks(
          createReadStream(capture.path),
          {
            name: capture.path.split("/").at(-1) ?? capture.path,
            sizeBytes: capture.observed.bytes,
          },
        );
        expect(result.ok, capture.path).toBe(true);
        if (!result.ok) continue;

        expect(result.value.recordsScanned, capture.path).toBe(
          capture.observed.records,
        );
        expect(
          new Set(result.value.players.map((player) => player.guid)),
          capture.path,
        ).toEqual(
          new Set(
            capture.approvedGroundTruth.playerCharacters.map(
              (player) => player.guid,
            ),
          ),
        );
        for (const approved of capture.approvedGroundTruth.playerCharacters) {
          expect(
            result.value.players.find((player) => player.guid === approved.guid)
              ?.name,
            capture.path,
          ).toBe(approved.name);
        }
        expect(result.value.proposedRecorderGuid, capture.path).toBe(
          capture.approvedGroundTruth.recorderCandidateGuids[0],
        );
        const observedTargets = new Set(
          result.value.targets.map((target) => target.guid),
        );
        for (const approved of capture.approvedGroundTruth.dummyCandidates) {
          expect(observedTargets.has(approved.guid), capture.path).toBe(true);
          expect(
            result.value.targets.find((target) => target.guid === approved.guid)
              ?.name,
            capture.path,
          ).toBe(approved.name);
        }
        expect(result.value.retainedState, capture.path).toMatchObject({
          retainedCombatEventCount: 0,
          retainedRawLineCount: 0,
        });

        if ("attempts" in capture.approvedGroundTruth) {
          for (const approved of capture.approvedGroundTruth.attempts) {
            const session = result.value.sessions.find(
              (candidate) =>
                candidate.playerGuid === approved.playerGuid &&
                candidate.startTime.raw === approved.start &&
                (capture.id === "dummy-encounter"
                  ? candidate.durationTicks >= BigInt(approved.durationMs * 10)
                  : candidate.endTime.raw === approved.end),
            );
            const observedForPlayer = result.value.sessions
              .filter(
                (candidate) => candidate.playerGuid === approved.playerGuid,
              )
              .map((candidate) => ({
                start: candidate.startTime.raw,
                end: candidate.endTime.raw,
                targets: candidate.targetGuids,
              }));
            expect(
              session,
              `${capture.path}: ${approved.start}; observed ${JSON.stringify(observedForPlayer)}`,
            ).toBeDefined();
            expect(new Set(session?.targetGuids), capture.path).toEqual(
              new Set(approved.targetGuids),
            );
            if (capture.id !== "dummy-encounter") {
              expect(
                Number(session?.durationTicks ?? 0n) / 10,
                capture.path,
              ).toBe(approved.durationMs);
            }
          }
        }

        if ("encounterEnvelopes" in capture.approvedGroundTruth) {
          expect(result.value.sessions, capture.path).toEqual([]);
          expect(result.value.encounterEnvelopes, capture.path).toHaveLength(
            capture.approvedGroundTruth.encounterEnvelopes.length,
          );
          for (const approved of capture.approvedGroundTruth
            .encounterEnvelopes) {
            const envelope = result.value.encounterEnvelopes.find(
              (candidate) => candidate.startTime.raw === approved.start,
            );
            expect(envelope?.encounterId, capture.path).toBe(
              approved.encounterId,
            );
            expect(envelope?.name, capture.path).toBe(approved.name);
            expect(envelope?.success, capture.path).toBe(approved.success);
            expect(envelope?.endTime?.raw, capture.path).toBe(approved.end);
          }
        }

        if (
          "gapsMs" in capture.approvedGroundTruth &&
          "attempts" in capture.approvedGroundTruth
        ) {
          const approvedSessions = capture.approvedGroundTruth.attempts.map(
            (approved) =>
              result.value.sessions.find(
                (candidate) =>
                  candidate.playerGuid === approved.playerGuid &&
                  candidate.startTime.raw === approved.start &&
                  candidate.endTime.raw === approved.end,
              ),
          );
          const observedGaps = approvedSessions
            .slice(0, -1)
            .map((session, index) => {
              const next = approvedSessions[index + 1];
              if (session === undefined || next === undefined) return -1;
              return Number(
                (next.startTime.localTimeTicks -
                  session.endTime.localTimeTicks) /
                  10n,
              );
            });
          expect(observedGaps, capture.path).toEqual(
            capture.approvedGroundTruth.gapsMs,
          );
        }

        if ("ownedEntities" in capture.approvedGroundTruth) {
          const observedOwned = new Set(
            result.value.ownedEntities.map((entity) => entity.guid),
          );
          for (const approved of capture.approvedGroundTruth.ownedEntities) {
            expect(observedOwned.has(approved.guid), capture.path).toBe(true);
          }
        }
      }
    },
  );
});
