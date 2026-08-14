import type { ProcessingPhase, RawTimestamp } from "../core";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index] ?? unit;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${unit}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDuration(ticks: bigint): string {
  const safeTicks = ticks < 0n ? -ticks : ticks;
  const totalSeconds = safeTicks / 10_000n;
  const fractionalTicks = safeTicks % 10_000n;
  const hours = totalSeconds / 3600n;
  const minutes = (totalSeconds % 3600n) / 60n;
  const seconds = totalSeconds % 60n;
  const fraction = fractionalTicks
    .toString()
    .padStart(4, "0")
    .replace(/0+$/u, "");
  const secondText = `${String(seconds)}${fraction.length > 0 ? `.${fraction}` : ""}s`;
  if (hours > 0n) return `${String(hours)}h ${String(minutes)}m ${secondText}`;
  if (minutes > 0n) return `${String(minutes)}m ${secondText}`;
  return secondText;
}

export function formatVisibleTime(timestamp: RawTimestamp): string {
  return timestamp.raw;
}

export function phaseLabel(phase: ProcessingPhase): string {
  const labels: Readonly<Record<ProcessingPhase, string>> = {
    "opening-file": "Opening file",
    "validating-file": "Checking combat-log contents",
    "scanning-actors": "Finding characters and activity",
    "detecting-attempts": "Ranking training attempts",
    "processing-session": "Reading the selected attempt",
    "filtering-events": "Resolving pets and removing nearby activity",
    "building-result": "Building the session summary",
  };
  return labels[phase];
}

export function stringifyTechnicalDetails(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString(10) : item,
    2,
  );
}
