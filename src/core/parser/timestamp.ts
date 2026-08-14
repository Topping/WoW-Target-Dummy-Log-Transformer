import type {
  OperationResult,
  RawTimestamp,
  SourceLocation,
} from "../contracts";

import { parserFailure } from "./diagnostics";

const TIMESTAMP_PATTERN =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})\.(\d{1,4})$/;
const TICKS_PER_SECOND = 10_000n;
const TICKS_PER_DAY = 864_000_000n;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const lengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return lengths[month - 1] ?? 0;
}

/** Gregorian civil-day index relative to 1970-01-01, without applying a timezone. */
function civilDays(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

export function parseTimestamp(
  raw: string,
  location?: SourceLocation,
  rawLine?: string,
): OperationResult<RawTimestamp> {
  const match = TIMESTAMP_PATTERN.exec(raw);
  if (match === null) {
    return {
      ok: false,
      error: parserFailure(
        "MALFORMED_TIMESTAMP",
        "This record has a timestamp format the parser cannot identify.",
        location,
        rawLine,
        { timestamp: raw },
      ),
      warnings: [],
    };
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionalComponent = match[7];

  if (
    fractionalComponent === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return {
      ok: false,
      error: parserFailure(
        "INVALID_TIMESTAMP_VALUE",
        "This record contains an invalid calendar timestamp.",
        location,
        rawLine,
        { timestamp: raw },
      ),
      warnings: [],
    };
  }

  const secondsInDay = hour * 3600 + minute * 60 + second;
  const fractionalTicks = BigInt(fractionalComponent.padEnd(4, "0"));
  return {
    ok: true,
    value: {
      raw,
      fractionalComponent,
      localTimeTicks:
        BigInt(civilDays(year, month, day)) * TICKS_PER_DAY +
        BigInt(secondsInDay) * TICKS_PER_SECOND +
        fractionalTicks,
    },
    warnings: [],
  };
}

export function ticksToMilliseconds(ticks: bigint): number {
  return Number(ticks) / 10;
}
