# Architecture decisions

## ADR-001: React presentation over framework-independent processing

**Status:** Accepted for v0.2

**Date:** 2026-08-14

The application shell uses React 19 with Vite. React is limited to presentation
and application state in `src/ui`. Domain contracts live in `src/core` and use
no React or DOM APIs. Browser transport contracts live in `src/worker`; this is
the only boundary currently allowed to mention browser `File` objects.

The dependency direction is:

```text
ui -> worker protocol -> core contracts
```

Core never imports from worker or UI. Tests import core contracts in the Node
test environment to keep that boundary enforceable.

The Vite build uses relative asset paths (`base: './'`), so the generated
`dist/` directory is static and works at the repository-scoped GitHub Pages URL
without a runtime server. No backend, router, analytics, persistence, service
worker, or external state-management package is present.

Exact combat-log times use `bigint` counts of 100-microsecond ticks in memory.
The original timestamp text and fractional component are retained alongside the
ordering value. A later versioned JSON exporter will define the string encoding
for these integers rather than allowing implicit precision loss.

## ADR-002: Lossless incremental records and registered schemas

**Status:** Accepted for D02-D03

**Date:** 2026-08-14

Core parsing accepts byte iterables, incrementally decodes UTF-8 with a fatal
`TextDecoder`, and splits LF/CRLF records without importing `File`, React, or DOM
objects. The lower-level decoder exposes completed lines as chunks arrive and
flushes a final unterminated line. The convenience full-log parser is used by
schema conformance and capture smoke tests; future discovery and extraction
consumers will build bounded state over the same primitives in D04-D06.

CSV fields retain both exact source spelling and decoded value. Canonical events
therefore retain the raw line, all raw fields, decoded additional fields, origin,
line location, parser version, and schema ID. Schema normalization is limited to
stable prefixes demonstrated by the current captures. Patch-specific Advanced
Combat Logging tails remain opaque additional fields until evidence supports a
stronger interpretation.

Schemas are runtime-registered `CombatLogSchema` objects. Selection prefers a
project/log-version/build-range match; otherwise it chooses the latest installed
schema for the same project and emits `SCHEMA_FALLBACK`. A manual schema ID is a
developer/testing override. The first installed profile is
`retail-12.1.0-project-1-log-22`.

The D01 contracts changed where implementation required concrete losslessness:

- `ActorReference` now optionally carries GUID-derived `type` classification.
- `CombatEvent` now declares its family/normalization status, raw fields,
  parser/schema identity, and a typed payload.
- `RawCombatLogRecord` and `ParsedCombatLog` are public contracts, and `core`
  now exports parser runtime functions in addition to types.

`relativeTimeTicks` on a full-log parse is relative to the first parsed source
record. Later selected-session construction may derive the same field from the
selected visible start without changing the exact timestamp key.
