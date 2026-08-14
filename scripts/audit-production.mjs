import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const allowedExtensions = new Set([".html", ".css", ".js"]);
const forbiddenRuntimePatterns = [
  ["fetch call", /\bfetch\s*\(/u],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/u],
  ["WebSocket", /\bWebSocket\b/u],
  ["EventSource", /\bEventSource\b/u],
  ["sendBeacon", /\.sendBeacon\s*\(/u],
  ["localStorage", /\blocalStorage\b/u],
  ["sessionStorage", /\bsessionStorage\b/u],
  ["IndexedDB", /\bindexedDB\b/u],
  ["cookie mutation", /document\.cookie\s*=/u],
  ["service-worker registration", /serviceWorker\.register\s*\(/u],
  ["URL state mutation", /history\.(?:pushState|replaceState)\s*\(/u],
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

const files = await walk(DIST);
if (files.length === 0) throw new Error("Production build is empty.");
const workerFiles = files.filter((file) =>
  /parser\.worker-[A-Za-z0-9_-]+\.js$/u.test(file),
);
if (workerFiles.length !== 1) {
  throw new Error(
    `Expected one separately emitted parser worker, found ${String(workerFiles.length)}.`,
  );
}
for (const file of files) {
  const extension = extname(file);
  if (!allowedExtensions.has(extension)) {
    throw new Error(`Unexpected production artifact: ${relative(ROOT, file)}`);
  }
  if (![".html", ".js"].includes(extension)) continue;
  const content = await readFile(file, "utf8");
  for (const [label, pattern] of forbiddenRuntimePatterns) {
    if (pattern.test(content)) {
      throw new Error(`${label} found in ${relative(ROOT, file)}`);
    }
  }
  const withoutInertFrameworkUrls = content.replaceAll(
    /(?:http:\/\/www\.w3\.org\/(?:1999\/xlink|XML\/1998\/namespace|2000\/svg|1998\/Math\/MathML)|https:\/\/react\.dev\/errors\/)/gu,
    "",
  );
  if (/https?:\/\//u.test(withoutInertFrameworkUrls)) {
    throw new Error(`External URL found in ${relative(ROOT, file)}`);
  }
}

process.stdout.write(
  `Production privacy audit passed for ${String(files.length)} static artifacts.\n`,
);
