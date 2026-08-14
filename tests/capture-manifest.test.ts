import { readFile, stat } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import manifest from "../data/fixtures.manifest.json";
import schema from "../docs/fixture-manifest.schema.json";

describe("fixture manifest", () => {
  it("conforms to its JSON schema", () => {
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it("keeps every listed compact fixture present and non-empty", async () => {
    for (const fixture of manifest.compactFixtures) {
      expect((await stat(fixture.path)).size, fixture.path).toBeGreaterThan(0);
      expect(
        (await readFile(fixture.path, "utf8")).split("\n").length,
      ).toBeGreaterThan(2);
    }
  });

  it("records the approved split and multi-target labels", () => {
    const split = manifest.captures.find(
      (capture) => capture.id === "session-splitting",
    );
    const cleave = manifest.captures.find(
      (capture) => capture.id === "cleave-logs",
    );

    expect(split?.approvedGroundTruth.attempts).toHaveLength(4);
    expect(split?.approvedGroundTruth.gapsMs).toEqual([20_264, 33_489, 25_130]);
    expect(cleave?.approvedGroundTruth.attempts?.[0]?.targetGuids).toHaveLength(
      5,
    );
    expect(
      cleave?.approvedGroundTruth.attempts?.[0]?.qualifyingRecordCount,
    ).toBe(913);
  });
});
