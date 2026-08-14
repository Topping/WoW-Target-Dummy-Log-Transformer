import { describe, expect, it } from "vitest";

import {
  IncrementalLineDecoder,
  parseCombatLogChunks,
  parseRawRecord,
  parseTimestamp,
  serializeCsv,
  serializeRawRecord,
  tokenizeCsv,
} from "../src/core";

function decodeChunks(chunks: readonly Uint8Array[]) {
  const decoder = new IncrementalLineDecoder();
  const lines = [];
  for (const chunk of chunks) {
    const result = decoder.push(chunk);
    expect(result.ok).toBe(true);
    if (result.ok) lines.push(...result.value);
  }
  const final = decoder.finish();
  expect(final.ok).toBe(true);
  if (final.ok) lines.push(...final.value);
  return lines;
}

describe("incremental UTF-8 line decoding", () => {
  const source =
    '8/14/2026 12:00:00.0001  TEST,"Pølsefatter"\r\n' +
    "8/14/2026 12:00:00.0002  TEST,nil\n" +
    "8/14/2026 12:00:00.0003  TEST,final";
  const encoded = new TextEncoder().encode(source);

  it("is invariant under every single chunk boundary", () => {
    const expected = source.split(/\r?\n/u);
    for (let boundary = 0; boundary <= encoded.length; boundary += 1) {
      const lines = decodeChunks([
        encoded.slice(0, boundary),
        encoded.slice(boundary),
      ]);
      expect(
        lines.map((line) => line.raw),
        `byte boundary ${String(boundary)}`,
      ).toEqual(expected);
      expect(lines.at(-1)?.terminated).toBe(false);
    }
  });

  it("handles one-byte chunks, including a split multibyte character and CRLF", () => {
    const lines = decodeChunks([...encoded].map((byte) => Uint8Array.of(byte)));
    expect(lines.map((line) => line.raw)).toEqual(source.split(/\r?\n/u));
    expect(lines.map((line) => line.location.lineNumber)).toEqual([1, 2, 3]);
  });

  it("returns a typed decoding failure for malformed UTF-8", () => {
    const decoder = new IncrementalLineDecoder();
    const result = decoder.push(Uint8Array.of(0xc3, 0x28));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_UTF8", recoverable: true },
    });
  });
});

describe("exact combat-log timestamps", () => {
  it.each([
    ["8/14/2026 11:47:38.2112", "2112"],
    ["12/31/2024 23:59:59.9999", "9999"],
    ["2/29/2024 00:00:00.0001", "0001"],
  ])("preserves %s and its fractional component", (raw, fraction) => {
    const parsed = parseTimestamp(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.raw).toBe(raw);
      expect(parsed.value.fractionalComponent).toBe(fraction);
    }
  });

  it("uses one 100-microsecond tick for the fourth fractional digit", () => {
    const first = parseTimestamp("8/14/2026 11:47:38.2112");
    const second = parseTimestamp("8/14/2026 11:47:38.2113");
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.localTimeTicks - first.value.localTimeTicks).toBe(1n);
    }
  });

  it("calculates exact duration across a date boundary", () => {
    const first = parseTimestamp("12/31/2025 23:59:59.9999");
    const second = parseTimestamp("1/1/2026 00:00:00.0001");
    if (!first.ok || !second.ok) throw new Error("test timestamps must parse");
    expect(second.value.localTimeTicks - first.value.localTimeTicks).toBe(2n);
  });

  it.each([
    "2/29/2025 00:00:00.0000",
    "8/14/2026 24:00:00.0000",
    "8/14/2026 11:47:38.21123",
    "not-a-timestamp",
  ])("returns a typed failure for %s", (raw) => {
    expect(parseTimestamp(raw)).toMatchObject({
      ok: false,
      error: { recoverable: true },
    });
  });
});

describe("lossless CSV tokenization", () => {
  it.each([
    [
      '"Pølsefatter-ArgentDawn-EU",nil,0x80000000,,AOE',
      ["Pølsefatter-ArgentDawn-EU", "nil", "0x80000000", "", "AOE"],
    ],
    ['"a,b","escaped ""quote""",,last', ["a,b", 'escaped "quote"', "", "last"]],
    [",", ["", ""]],
    ['""', [""]],
  ])("tokenizes %s without losing raw spellings", (input, expected) => {
    const result = tokenizeCsv(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((field) => field.value)).toEqual(expected);
      expect(serializeCsv(result.value)).toBe(input);
    }
  });

  it.each(['"unterminated', 'plain"quote', '"closed"trailing'])(
    "returns a contextual typed failure for %s",
    (input) => {
      const result = tokenizeCsv(input, { lineNumber: 7 }, `raw ${input}`);
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "MALFORMED_CSV_QUOTE",
          technicalDetails: { location: { lineNumber: 7 } },
        },
      });
    },
  );
});

describe("generic raw records", () => {
  const raw = '8/14/2026 12:00:00.1234  CUSTOM_EVENT,"text, value",nil,,0x1';

  it("preserves the source line and every raw field", () => {
    const parsed = parseRawRecord(raw, { lineNumber: 9 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.fields.map((field) => field.raw)).toEqual([
        "CUSTOM_EVENT",
        '"text, value"',
        "nil",
        "",
        "0x1",
      ]);
      expect(serializeRawRecord(parsed.value)).toBe(raw);
    }
  });

  it("parses a complete log identically when bytes split inside every syntax feature", async () => {
    const text =
      "8/14/2026 12:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1\r\n" +
      raw;
    const bytes = new TextEncoder().encode(text);
    const chunks = [...bytes].map((byte) => Uint8Array.of(byte));
    const result = await parseCombatLogChunks(chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.records.map((record) => record.raw)).toEqual(
        text.split(/\r?\n/u),
      );
    }
  });
});
