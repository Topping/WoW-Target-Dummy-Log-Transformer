# Architecture decisions

## ADR-001: React presentation over framework-independent processing

**Status:** Accepted for v0.2

**Date:** 2026-08-14

The application shell uses React 19 with Vite. React is limited to presentation
and application state in `src/ui`. Domain contracts live in `src/core` and use
no React or DOM APIs. Browser transport contracts live in `src/worker`; this is
the only processing boundary allowed to read browser `File` objects. The UI may
retain and pass an opaque `File` handle while coordinating the two worker passes,
but it never reads or parses that file.

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
ordering value. D07's versioned JSON exporter encodes every tick value as a
base-10 JSON string rather than allowing implicit precision loss.

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

## ADR-003: Browser transport lifecycle and bounded pass-one discovery

**Status:** Accepted for D04-D05

**Date:** 2026-08-14

The browser worker owns `File`/`Blob` sampling and streaming. Core discovery
accepts byte iterables plus plain `InputFileMetadata`; it does not import DOM,
React, worker, or browser file types. The main-thread client accepts only the
currently active operation ID, so a cancelled or superseded operation cannot
advance application state.

Pass one tokenizes raw records through the D02 incremental decoder but never
constructs or retains a complete `CombatEvent` collection. Its retained state is
maps of actor, target, ownership, encounter, and candidate-window aggregates.
The returned retention counters explicitly report zero retained events and raw
lines, making this boundary regression-testable.

The current Retail schema now declares discovery boundary event names.
`ENCOUNTER_START`/`ENCOUNTER_END` form genuine encounter envelopes;
`COMBAT_LOG_VERSION`, zone/map changes, target death/destruction, and backwards
timestamps stop candidate windows as applicable. This is a public extension to
`CombatLogSchema`, allowing future schemas to name different explicit records
without hard-wiring version checks into discovery.

The D01 discovery contracts became concrete in D05:

- `DiscoveryResult` includes the uniquely proposed recorder GUID only when one
  player GUID/type carries `AFFILIATION_MINE`, retained encounter envelopes,
  owned-entity observations, and aggregate-retention counters.
- player and target candidates expose the component activity measures used for
  deterministic ranking;
- session candidates expose qualifying/player-initiated counts and typed reason
  codes;
- `SessionDiscoveryOptions` contains configurable inactivity and confidence
  thresholds. Defaults are exported rather than embedded in sessionization.
  `DISCOVER_FILE` may carry those options through the browser transport.

`PROCESS_SESSION` transport, progress, cancellation, completion, error, and
stale-result handling are implemented in D04. The runtime accepts a typed
`SessionProcessor`; D06 installs the real streaming processor in the production
browser worker.

## ADR-004: Bounded session extraction and versioned local exports

**Status:** Accepted for D06-D07

**Date:** 2026-08-14

Core extraction accepts byte iterables, plain file metadata, a selected visible
window, and plain options. The browser worker alone reads `File` contents and
owns Blob streaming and operation publication. Extraction retains the
log-version record required for a standalone filtered log, cheaply
timestamp-skips other pre-window lines, fully parses the inclusive pre-roll
through post-roll range, and stops on the first record beyond it. The visible
`Session.startTime`, `endTime`, and duration always remain the selected discovery
boundaries.

Ownership is an evidence graph. Advanced owner GUIDs outrank summon/create
edges, which outrank the selected recorder's `AFFILIATION_MINE` assumption.
Conflicts keep the stronger edge and emit a structured
`OWNERSHIP_CONFLICT` warning containing both claims. Actor names are never
evidence. Filtering is resolved only after the graph is built so earlier events
benefit from later evidence in the bounded extraction window.

Retained-event and UTF-8 source-byte budgets are optional public options. No
soft or hard default is installed before D10 measurement. A soft crossing warns
once and continues; a hard crossing returns a recoverable error and no partial
`Session`.

Core export code produces deterministic strings only. Session JSON format v1
has a committed schema and decimal-string bigint encoding; filtered log output
concatenates each retained raw line with its exact source terminator. Browser
transport creates Blobs and assigns deterministic safe filenames. Neither path
uses network requests, storage, cookies, or a backend. The JSON capability
remains available to core and transport consumers, but the public converter UI
exposes only the encounter-log download.

## ADR-005: Reducer-driven local workflow and ephemeral downloads

**Status:** Accepted for D08-D09

**Date:** 2026-08-14

The React workflow is a discriminated-union reducer covering waiting,
discovery, explicit character selection when needed, session selection,
processing, result, recoverable error, and cancellation.
Side effects remain in a thin application coordinator around
`ParserWorkerClient`; presentation components receive domain results and never
reimplement discovery, extraction, filtering, or serialization.

A valid unique recorder proposal proceeds directly to session selection. The
full character list is shown only when discovery cannot identify the recorder
unambiguously, and remains reachable through **Change character**. The
coordinator automatically processes exactly one Likely attempt; ambiguous
attempt sets use direct **Use this attempt** actions instead of a selection plus
confirmation pair.

The UI adds its own monotonically increasing operation token to each worker
promise. The reducer ignores progress or terminal actions whose token does not
match the currently active state. This preserves coherent start-over, retry,
and cancellation behavior even before the worker client's independent stale
response filter is considered.

The interface is positioned as a converter and keeps the common path to file
choice followed by encounter-log download. Progress copy is concise while exact
byte values remain available through the native progress element. Normal labels
never expose GUIDs. Exact times and durations are formatted from the existing
raw timestamp and bigint tick contracts. The result leads with the download and
essential character/duration/target context; attempt details and technical
identifiers, schema metadata, warnings, and optional debug decisions live inside
closed disclosures.

Local-processing trust copy appears once on the landing intake. It is removed
with the marketing hero after file selection. There is no standalone product
header or “Browser only” badge. These are presentation decisions only: the no-network
architecture and privacy audits remain unchanged.

`saveSessionDownload` is the DOM completion of D07's
`createSessionDownload`: it uses a temporary anchor and object URL, removes the
anchor, and revokes the URL in `finally`. Export serialization and deterministic
filename generation remain in the existing core/browser transport contracts.
The public UI invokes this path only for `encounter-log`; JSON remains an
internal core capability.
The complete UI behavior is documented in [`ui-workflow.md`](ui-workflow.md).

## ADR-006: Measured safety budgets and production browser hardening

**Status:** Accepted for D10

**Date:** 2026-08-14

D10 installs measured default retained-event, retained-source-byte, and export
budgets. The values and their fixture/hardware multiples are recorded in
[`d10-hardening.md`](d10-hardening.md); they limit selected retained data, not
the size of a streamed source file. Explicit advanced options replace the
corresponding default set. Soft limits warn and complete, while hard limits fail
recoverably and return no truncated asset.

Production worker construction uses Vite's statically analyzable literal
`new Worker(new URL(..., import.meta.url), { type: "module" })` form. This is an
enforced build contract: the privacy audit requires a separate worker asset, and
the large-capture browser heartbeat verifies that parsing does not migrate to
the main thread. Vite's unused modulepreload polyfill is disabled so the built
runtime contains no fetch call.

Browser confidence is deliberately evidence-labelled: installed headless
Chrome is genuine Chrome coverage; Playwright Chromium, Firefox, and WebKit are
engine proxies, not Edge, installed Firefox, or installed Safari certification.
No browser-specific compatibility fallback is justified by the current matrix.

## ADR-007: Gated, four-file GitHub Pages release

**Status:** Accepted for D11

**Date:** 2026-08-14

GitHub Pages receives only `dist/` after the same formatting, linting, strict
typechecking, compact tests, explicitly named capture-wide/performance checks,
production build, and privacy audit used by repository quality validation. A
separate Pages artifact audit requires exactly `index.html`, one hashed CSS
entry, one hashed JavaScript entry, and one separately emitted hashed parser
worker. It rejects maps, source captures, environment/secret material,
symlinks, and any unexpected file rather than relying on a broad extension
allowlist.

Relative Vite entry assets remain the accepted repository-scoped path strategy.
The emitted application resolves the parser worker relative to its own module.
A development-only static server mounts the exact `dist/` directory at
`/WoW-Target-Dummy-Log-Transformer/`; it is used by Playwright to verify direct
loading, refresh, asset and worker URLs, downloads, and privacy behavior without
entering the deployment artifact.

The Pages workflow validates the local repository-scoped artifact in Playwright
Chromium, Firefox, and WebKit proxies before deployment, then repeats the direct
load and complete real-cleave file-to-encounter-export smoke against the URL
returned by GitHub after deployment. Those are still proxy-engine results, not actual
Edge, installed Firefox, or installed Safari certification. The workflow adds
no router, backend, persistence, analytics, PWA, or service worker.

At D11 implementation time GitHub's public metadata reported Pages disabled and
the expected URL returned 404. After repository-owner enablement, release commit
`7c9ff05c38dc1f3a4d11674bf4371e56a7ef72c7` passed Quality, artifact validation,
deployment, the deployed proxy-engine smoke, and an additional deployed genuine
installed-Chrome smoke. The live URL returned HTTP 200. The complete release,
sign-off, and rollback record is
[`d11-release-checklist.md`](d11-release-checklist.md).
