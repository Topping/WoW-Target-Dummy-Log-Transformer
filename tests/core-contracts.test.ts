import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  NonEmptyReadonlyArray,
  Session,
  SessionCandidate,
} from "../src/core";

describe("framework-independent core contracts", () => {
  it("imports in Node and models one or more targets without browser or React values", async () => {
    const coreModule = await import("../src/core");
    const targetGuids = [
      "Creature-primary",
      "Creature-secondary",
    ] as const satisfies NonEmptyReadonlyArray<string>;
    const candidate: Pick<SessionCandidate, "playerGuid" | "targetGuids"> = {
      playerGuid: "Player-example",
      targetGuids,
    };

    expect(coreModule).toHaveProperty("parseCombatLogChunks");
    expect(coreModule).toHaveProperty("defaultSchemaRegistry");
    expect(candidate.targetGuids).toHaveLength(2);
    expectTypeOf<Session["targets"]>().toExtend<
      NonEmptyReadonlyArray<Session["targets"][number]>
    >();
  });
});
