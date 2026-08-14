import { readFile } from "node:fs/promises";
import { File } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import manifest from "../data/fixtures.manifest.json";
import { ParserWorkerRuntime, type WorkerResponse } from "../src/worker";

describe("capture-wide browser worker smoke test", () => {
  it(
    "streams the noisy capture through discovery with exact final byte progress",
    { timeout: 120_000 },
    async () => {
      const capture = manifest.captures.find(
        (candidate) => candidate.id === "dummy-encounter",
      );
      if (capture === undefined)
        throw new Error("missing noisy capture manifest");
      const bytes = await readFile(capture.path);
      const file = new File([bytes], "renamed-capture.bin");
      const responses: WorkerResponse[] = [];
      const runtime = new ParserWorkerRuntime((response) => {
        responses.push(response);
      });
      runtime.handle({
        type: "DISCOVER_FILE",
        operationId: "capture-discovery",
        file,
      });

      for (let attempt = 0; attempt < 2_000; attempt += 1) {
        if (
          responses.some((response) => response.type === "DISCOVERY_COMPLETE")
        ) {
          break;
        }
        await delay(1);
      }
      const complete = responses.find(
        (response) => response.type === "DISCOVERY_COMPLETE",
      );
      expect(complete?.type).toBe("DISCOVERY_COMPLETE");
      if (complete?.type !== "DISCOVERY_COMPLETE") return;
      expect(complete.result.proposedRecorderGuid).toBe(
        capture.approvedGroundTruth.recorderCandidateGuids[0],
      );
      const scanning = responses
        .filter(
          (response) =>
            response.type === "PROGRESS" &&
            response.progress.phase === "scanning-actors",
        )
        .map((response) =>
          response.type === "PROGRESS" ? response.progress.bytesProcessed : 0,
        );
      expect(scanning.at(-1)).toBe(capture.observed.bytes);
      expect(scanning).toEqual(
        [...scanning].sort((left, right) => left - right),
      );
    },
  );
});
