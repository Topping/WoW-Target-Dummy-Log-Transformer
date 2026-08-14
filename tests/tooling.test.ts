import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

describe("repository quality tooling", () => {
  it("installs and keeps the committed pre-commit checks", async () => {
    const hook = await readFile(".husky/pre-commit", "utf8");

    expect(packageJson.scripts.prepare).toBe("husky");
    expect(hook).toContain("lint-staged");
    expect(hook).toContain("npm run typecheck");
  });
});
