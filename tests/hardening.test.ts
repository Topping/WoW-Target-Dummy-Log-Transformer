import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("D10 privacy and worker-boundary regressions", () => {
  it("keeps parsing, discovery, and extraction off the UI/main-thread module graph", async () => {
    const uiFiles = await sourceFiles("src/ui");
    for (const path of uiFiles) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /from\s+["'][^"']*\/(?:parser|discovery|extraction)(?:\/|["'])/u,
      );
      expect(source, path).not.toMatch(/\b(?:FileReader|parseRawRecord)\b/u);
      expect(source, path).not.toMatch(/\.text\(\)|\.arrayBuffer\(\)/u);
    }
    const app = await readFile("src/ui/App.tsx", "utf8");
    expect(app).toContain("ParserWorkerClient");
    expect(app).not.toContain("discoverCombatLogChunks");
    expect(app).not.toContain("extractSessionChunks");
  });

  it("contains no runtime network, persistence, analytics, service-worker, or URL mutation path", async () => {
    const files = await sourceFiles("src");
    const forbidden = [
      /\bfetch\s*\(/u,
      /\bXMLHttpRequest\b/u,
      /\bWebSocket\b/u,
      /\bEventSource\b/u,
      /\.sendBeacon\s*\(/u,
      /\blocalStorage\s*\./u,
      /\bsessionStorage\s*\./u,
      /\bindexedDB\s*\./u,
      /\bdocument\.cookie\b/u,
      /\bserviceWorker\.register\s*\(/u,
      /\bhistory\.(?:pushState|replaceState)\s*\(/u,
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      for (const pattern of forbidden)
        expect(source, path).not.toMatch(pattern);
    }
  });
});
