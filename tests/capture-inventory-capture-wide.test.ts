import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import manifest from "../data/fixtures.manifest.json";

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

describe("explicit capture-wide inventory smoke", () => {
  it("streams each real capture without loading it into memory", async () => {
    for (const capture of manifest.captures) {
      const fileStat = await stat(capture.path);
      const fingerprint = await streamFingerprint(capture.path);
      expect(fileStat.size, capture.path).toBe(capture.observed.bytes);
      expect(fingerprint.records, capture.path).toBe(capture.observed.records);
      expect(fingerprint.sha256, capture.path).toBe(capture.observed.sha256);
    }
  });
});
