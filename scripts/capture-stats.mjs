#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RECORD_PATTERN = /^(\S+ \S+) {2}([A-Z][A-Z0-9_]+),(.*)$/;

function tokenizeCsv(value) {
  const fields = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((character === "," || index === value.length) && !quoted) {
      fields.push(current);
      current = "";
    } else if (character !== undefined) {
      current += character;
    }
  }

  return fields;
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function observeActor(map, guid, name, flags) {
  if (guid === undefined || name === undefined || !guid.startsWith("Player-"))
    return;

  const existing = map.get(guid) ?? {
    guid,
    name,
    observations: 0,
    affiliationMine: false,
  };
  existing.observations += 1;
  existing.affiliationMine ||= (Number.parseInt(flags ?? "0", 16) & 1) === 1;
  map.set(guid, existing);
}

function observeDummy(map, guid, name) {
  if (guid === undefined || name === undefined || !guid.startsWith("Creature-"))
    return;
  if (!name.toLocaleLowerCase("en").includes("dummy")) return;

  const existing = map.get(guid) ?? { guid, name, observations: 0 };
  existing.observations += 1;
  map.set(guid, existing);
}

function byObservations(left, right) {
  return (
    right.observations - left.observations ||
    left.guid.localeCompare(right.guid)
  );
}

export async function inspectCapture(filePath, rootDirectory = process.cwd()) {
  const absolutePath = resolve(rootDirectory, filePath);
  const fileStat = await stat(absolutePath);
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const eventTypes = new Map();
  const players = new Map();
  const dummies = new Map();
  const encounters = [];
  let pending = "";
  let recordCount = 0;
  let firstTimestamp;
  let lastTimestamp;
  let version;

  function inspectLine(rawLine) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) return;
    const match = RECORD_PATTERN.exec(line);
    if (match === null) return;

    const [, timestamp, eventType, payload] = match;
    recordCount += 1;
    firstTimestamp ??= timestamp;
    lastTimestamp = timestamp;
    increment(eventTypes, eventType);

    const fields = tokenizeCsv(payload);
    if (eventType === "COMBAT_LOG_VERSION") {
      version = {
        logVersion: Number(fields[0]),
        advancedLoggingEnabled: fields[2] === "1",
        buildVersion: fields[4] ?? "unknown",
        projectId: Number(fields[6]),
      };
    }

    if (eventType === "COMBATANT_INFO") {
      observeActor(players, fields[0], fields[0], "0");
    } else {
      observeActor(players, fields[0], fields[1], fields[2]);
      observeActor(players, fields[4], fields[5], fields[6]);
      observeDummy(dummies, fields[0], fields[1]);
      observeDummy(dummies, fields[4], fields[5]);
    }

    if (eventType === "ENCOUNTER_START" || eventType === "ENCOUNTER_END") {
      encounters.push({
        eventType,
        timestamp,
        encounterId: Number(fields[0]),
        name: fields[1] ?? "unknown",
        success: eventType === "ENCOUNTER_END" ? fields[5] === "1" : undefined,
      });
    }
  }

  for await (const chunk of createReadStream(absolutePath)) {
    hash.update(chunk);
    pending += decoder.decode(chunk, { stream: true });
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex >= 0) {
      inspectLine(pending.slice(0, newlineIndex));
      pending = pending.slice(newlineIndex + 1);
      newlineIndex = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  inspectLine(pending);

  return {
    path: relative(rootDirectory, absolutePath),
    bytes: fileStat.size,
    sha256: hash.digest("hex"),
    records: recordCount,
    timeRange: { first: firstTimestamp ?? null, last: lastTimestamp ?? null },
    version: version ?? null,
    eventTypes: Object.fromEntries(
      [...eventTypes].sort(([left], [right]) => left.localeCompare(right)),
    ),
    players: [...players.values()].sort(byObservations),
    dummyCandidates: [...dummies.values()].sort(byObservations),
    encounterEnvelopeEvents: encounters,
  };
}

async function defaultCapturePaths(rootDirectory) {
  const dataDirectory = resolve(rootDirectory, "data");
  const entries = await readdir(dataDirectory);
  return entries
    .filter((entry) => entry.endsWith(".txt"))
    .sort()
    .map((entry) => `data/${entry}`);
}

async function main() {
  const rootDirectory = process.cwd();
  const argumentsWithoutFlags = process.argv
    .slice(2)
    .filter((argument) => argument !== "--json");
  if (argumentsWithoutFlags.includes("--help")) {
    process.stdout.write(
      "Usage: npm run captures:stats -- [data/capture.txt ...]\n\n" +
        "Streams capture files and prints descriptive JSON to stdout. It never writes to the fixture manifest.\n",
    );
    return;
  }

  const paths =
    argumentsWithoutFlags.length > 0
      ? argumentsWithoutFlags
      : await defaultCapturePaths(rootDirectory);
  const captures = [];
  for (const filePath of paths)
    captures.push(await inspectCapture(filePath, rootDirectory));
  process.stdout.write(
    `${JSON.stringify({ generatedAt: new Date().toISOString(), captures }, null, 2)}\n`,
  );
}

const isCommandLine =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCommandLine) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Capture inspection failed: ${message}\n`);
    process.exitCode = 1;
  });
}
