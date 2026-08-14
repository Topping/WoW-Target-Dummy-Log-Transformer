# Parser and schema behavior

This document records the concrete D02-D03 behavior. The parser is framework
independent and accepts `Iterable<Uint8Array>` or
`AsyncIterable<Uint8Array>`; it has no browser `File`, React, or UI dependency.

## Incremental input

`IncrementalLineDecoder` uses streaming UTF-8 decoding, so a chunk may end in a
multibyte character. LF and CRLF are accepted even when the two CRLF bytes arrive
in different chunks. Each decoded record retains its exact `\n`, `\r\n`, or
unterminated `""` source terminator for exact source retention. `finish()` returns a
final unterminated line. Invalid UTF-8 is a typed recoverable `INVALID_UTF8`
failure with line context.

`parseCombatLogChunks` is the full-log conformance API. It consumes byte chunks
without `File.text()` or whole-file string splitting. `parseCombatLogText` is a
compact-fixture convenience wrapper and is not the large browser-file intake
path planned for D04.

## Timestamps and CSV

Timestamps retain their exact source text and fractional component. Their
canonical comparison key is a timezone-unspecified `bigint` count of
100-microsecond ticks based on the Gregorian civil date. One change in the
fourth fractional digit is one tick; floating-point milliseconds are derived
only through an explicit helper.

Each CSV token is represented by:

- `raw`: exact source spelling, including quotes and doubled quote escapes;
- `value`: decoded content;
- `quoted`: whether the source token was quoted.

This preserves empty fields, the literal `nil`, hexadecimal text, embedded
commas, escaped quotes, Unicode, and Advanced Combat Logging fields. Serializing
raw fields reproduces their original spelling.

## Retail 12.1.0 schema

The registered schema ID is `retail-12.1.0-project-1-log-22`. Compatibility is
Retail project 1, combat-log version 22, and build range 12.1.0 through 12.1.0.
It normalizes the D03 priority families:

- casts: start, success, and failed;
- spell/periodic/swing/range damage;
- aura apply, refresh, remove, and dose variants;
- energize, periodic energize, and drain;
- summon and create;
- unit death and destruction;
- `COMBATANT_INFO`;
- encounter start/end.

Stable common actor and spell prefixes are normalized. Remaining fields are
retained in `additionalFields`, and every original token remains in `rawFields`.
This is intentional for advanced tails whose precise meaning varies by event and
client version.

GUID prefixes classify actor references as player, creature, pet, guardian,
vehicle, or unknown. A zero GUID and `nil` remain unknown; actor names never
establish ownership. Generic events also expose source/destination actors when
their stable common actor header is structurally recognizable; they remain
`normalized: false`, retain all raw fields, and still emit the unknown-event
warning.

## Compatibility and failures

Schema selection is explicit in `ParserMetadata`. Exact compatibility wins. If
there is no exact match, the newest registered schema for the same WoW project
is selected and both metadata and a `SCHEMA_FALLBACK` warning record that fact.
An unsupported project is a typed recoverable failure.

An unknown event or a supported event shorter than its stable minimum is
retained as a generic raw event with a contextual warning. Malformed timestamp,
CSV quoting, UTF-8, version metadata, or record structure returns a typed
recoverable failure rather than throwing from source-data handling. Naturally
occurring encounter and combatant records are retained; absent records are never
created.

## Pass-one consumer

`discoverCombatLogChunks` reuses `IncrementalLineDecoder`, `parseRawRecord`, log
version parsing, and the schema registry, but deliberately does not call the
full-log normalizer. It extracts only timestamps, event names, common actors,
flags, and minimal interaction fields into bounded aggregates. This keeps the
full conformance parser available for compact/schema tests while avoiding a
capture-sized `CombatEvent[]` during browser discovery.
