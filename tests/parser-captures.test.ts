import { createReadStream } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "../data/fixtures.manifest.json";
import { parseCombatLogChunks, retail12_1_0Schema } from "../src/core";

const PRIORITY_EVENT_TYPES = new Set([
  "SPELL_CAST_START",
  "SPELL_CAST_SUCCESS",
  "SPELL_CAST_FAILED",
  "SPELL_DAMAGE",
  "SPELL_PERIODIC_DAMAGE",
  "SWING_DAMAGE",
  "RANGE_DAMAGE",
  "SPELL_AURA_APPLIED",
  "SPELL_AURA_REFRESH",
  "SPELL_AURA_REMOVED",
  "SPELL_AURA_APPLIED_DOSE",
  "SPELL_AURA_REMOVED_DOSE",
  "SPELL_ENERGIZE",
  "SPELL_PERIODIC_ENERGIZE",
  "SPELL_DRAIN",
  "SPELL_SUMMON",
  "SPELL_CREATE",
  "UNIT_DIED",
  "UNIT_DESTROYED",
  "COMBATANT_INFO",
  "ENCOUNTER_START",
  "ENCOUNTER_END",
]);

describe("capture-wide streaming parser smoke test", () => {
  it(
    "parses every real capture and normalizes every observed priority event",
    { timeout: 120_000 },
    async () => {
      for (const capture of manifest.captures) {
        const result = await parseCombatLogChunks(
          createReadStream(capture.path),
        );
        expect(result.ok, capture.path).toBe(true);
        if (!result.ok) continue;

        expect(result.value.linesRead, capture.path).toBe(
          capture.observed.records,
        );
        expect(result.value.records, capture.path).toHaveLength(
          capture.observed.records,
        );
        expect(result.value.parser.schema, capture.path).toMatchObject({
          id: retail12_1_0Schema.id,
          selection: "exact",
          detectedVersion: capture.observed.version,
        });

        const observedPriorityTypes = Object.keys(
          capture.observed.eventTypes,
        ).filter((eventType) => PRIORITY_EVENT_TYPES.has(eventType));
        for (const eventType of observedPriorityTypes) {
          const events = result.value.records.filter(
            (event) => event.type === eventType,
          );
          expect(
            events.length,
            `${capture.path}: ${eventType}`,
          ).toBeGreaterThan(0);
          expect(
            events.every((event) => event.normalized),
            `${capture.path}: ${eventType}`,
          ).toBe(true);
        }
      }
    },
  );
});
