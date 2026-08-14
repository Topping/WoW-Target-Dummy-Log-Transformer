import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import manifest from "../data/fixtures.manifest.json";
import schema from "../docs/fixture-manifest.schema.json";

async function streamFingerprint(path: string) {
  const hash = createHash("sha256");
  let records = 0;
  const stream: AsyncIterable<Buffer> = createReadStream(path);

  for await (const chunk of stream) {
    hash.update(chunk);
    for (const byte of chunk) if (byte === 0x0a) records += 1;
  }

  return { records, sha256: hash.digest("hex") };
}

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

  it("streams the real capture inventory once without loading captures into memory", async () => {
    for (const capture of manifest.captures) {
      const fileStat = await stat(capture.path);
      const fingerprint = await streamFingerprint(capture.path);
      expect(fileStat.size, capture.path).toBe(capture.observed.bytes);
      expect(fingerprint.records, capture.path).toBe(capture.observed.records);
      expect(fingerprint.sha256, capture.path).toBe(capture.observed.sha256);
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
