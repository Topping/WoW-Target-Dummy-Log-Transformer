import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const requestedDirectory = process.argv[2];
const artifactDirectory =
  requestedDirectory === undefined
    ? fileURLToPath(new URL("../dist/", import.meta.url))
    : resolve(ROOT, requestedDirectory);

const expectedFiles = [
  /^index\.html$/u,
  /^assets\/index-[A-Za-z0-9_-]+\.css$/u,
  /^assets\/index-[A-Za-z0-9_-]+\.js$/u,
  /^assets\/parser\.worker-[A-Za-z0-9_-]+\.js$/u,
];
const forbiddenContent = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  ],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  ["real-capture character", /Pølsefatter|Player-3702-0A70D8DF/u],
  ["real-capture creature GUID", /Creature-0-(?:1469|3890)-0-/u],
  ["source map reference", /[#@]\s*sourceMappingURL=/u],
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in the Pages artifact: ${relative(ROOT, path)}`,
      );
    }
    if (entry.isDirectory()) {
      const directoryPath = relative(artifactDirectory, path)
        .split(sep)
        .join("/");
      if (directoryPath !== "assets") {
        throw new Error(
          `Unexpected directory in Pages artifact: ${directoryPath}`,
        );
      }
      paths.push(...(await walk(path)));
    } else if (entry.isFile()) paths.push(path);
    else {
      throw new Error(
        `Non-regular artifact entry is not allowed: ${relative(ROOT, path)}`,
      );
    }
  }
  return paths;
}

function artifactPath(path) {
  const value = relative(artifactDirectory, path).split(sep).join("/");
  if (value.startsWith("../") || value === "..") {
    throw new Error(`Artifact path escaped its root: ${value}`);
  }
  return value;
}

const files = (await walk(artifactDirectory))
  .map((path) => ({ path, artifactPath: artifactPath(path) }))
  .sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));

if (files.length !== expectedFiles.length) {
  throw new Error(
    `Expected exactly ${String(expectedFiles.length)} Pages files, found ${String(files.length)}: ${files.map((file) => file.artifactPath).join(", ")}`,
  );
}

for (const expected of expectedFiles) {
  const matches = files.filter((file) => expected.test(file.artifactPath));
  if (matches.length !== 1) {
    throw new Error(
      `Expected one artifact matching ${String(expected)}, found ${String(matches.length)}.`,
    );
  }
}

const indexFile = files.find((file) => file.artifactPath === "index.html");
if (indexFile === undefined)
  throw new Error("Pages artifact has no index.html.");
const index = await readFile(indexFile.path, "utf8");
const entryFiles = files.filter((file) =>
  /^assets\/index-[A-Za-z0-9_-]+\.(?:css|js)$/u.test(file.artifactPath),
);
for (const entry of entryFiles) {
  if (!index.includes(`./${entry.artifactPath}`)) {
    throw new Error(
      `index.html does not use the required relative reference for ${entry.artifactPath}.`,
    );
  }
}
if (/\b(?:src|href)=["']\/(?!\/)/u.test(index)) {
  throw new Error("index.html contains a root-absolute asset reference.");
}

const workerFile = files.find((file) =>
  /^assets\/parser\.worker-[A-Za-z0-9_-]+\.js$/u.test(file.artifactPath),
);
const applicationFile = files.find((file) =>
  /^assets\/index-[A-Za-z0-9_-]+\.js$/u.test(file.artifactPath),
);
if (workerFile === undefined || applicationFile === undefined) {
  throw new Error(
    "Pages artifact is missing its application or parser worker.",
  );
}
const application = await readFile(applicationFile.path, "utf8");
if (!application.includes(workerFile.artifactPath.replace("assets/", ""))) {
  throw new Error(
    "The application bundle does not reference the emitted worker.",
  );
}

for (const file of files) {
  const content = await readFile(file.path, "utf8");
  for (const [label, pattern] of forbiddenContent) {
    if (pattern.test(content)) {
      throw new Error(`${label} found in Pages artifact ${file.artifactPath}.`);
    }
  }
}

process.stdout.write(
  `Pages artifact audit passed: ${files.map((file) => file.artifactPath).join(", ")}\n`,
);
