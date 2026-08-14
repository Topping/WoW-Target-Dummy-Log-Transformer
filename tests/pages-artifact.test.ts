import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function createValidArtifact(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wow-pages-artifact-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "assets"));
  await Promise.all([
    writeFile(
      join(directory, "index.html"),
      '<script type="module" src="./assets/index-release123.js"></script><link rel="stylesheet" href="./assets/index-release123.css">',
    ),
    writeFile(
      join(directory, "assets/index-release123.js"),
      'new URL("parser.worker-worker123.js", import.meta.url);',
    ),
    writeFile(join(directory, "assets/index-release123.css"), "body{}"),
    writeFile(
      join(directory, "assets/parser.worker-worker123.js"),
      "self.onmessage=()=>{};",
    ),
  ]);
  return directory;
}

async function audit(directory: string): Promise<void> {
  await execFileAsync(process.execPath, [
    "scripts/audit-pages-artifact.mjs",
    directory,
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("D11 Pages artifact regression", () => {
  it("accepts only the expected static entry, style, application, and worker", async () => {
    await expect(audit(await createValidArtifact())).resolves.toBeUndefined();
  });

  it.each([
    ["source map", "assets/index-release123.js.map", "{}"],
    ["source capture", "capture.log", "COMBAT_LOG_VERSION,22"],
    ["environment file", ".env", "TOKEN=development-only"],
  ])("rejects an unexpected %s file", async (_label, path, content) => {
    const directory = await createValidArtifact();
    await writeFile(join(directory, path), content);
    await expect(audit(directory)).rejects.toThrow(
      /Expected exactly 4 Pages files/u,
    );
  });

  it("rejects an unexpected empty directory", async () => {
    const directory = await createValidArtifact();
    await mkdir(join(directory, "data"));
    await expect(audit(directory)).rejects.toThrow(
      /Unexpected directory in Pages artifact/u,
    );
  });

  it.each([
    ["private key", "-----BEGIN PRIVATE KEY-----"],
    ["real capture identity", "Player-3702-0A70D8DF"],
    ["source-map directive", "//# sourceMappingURL=application.js.map"],
  ])("rejects %s content embedded in a bundle", async (_label, content) => {
    const directory = await createValidArtifact();
    await writeFile(
      join(directory, "assets/parser.worker-worker123.js"),
      content,
    );
    await expect(audit(directory)).rejects.toThrow(/found in Pages artifact/u);
  });
});
