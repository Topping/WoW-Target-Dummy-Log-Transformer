# v0.2 delivery plan

**Status:** Initial breakdown  
**Source of truth:** [`../spec.md`](../spec.md)  
**Release target:** A static, browser-only application that extracts one selected
player's interaction with one or more training dummies during one selected
attempt.

## How to use this plan

Each numbered chunk is intended to be independently reviewable and mergeable. A
chunk must leave the repository in a working state, include its own tests, and
meet its acceptance criteria without relying on unmerged follow-up work.

The chunks describe outcomes rather than branches or calendar milestones. They
may be split into smaller pull requests when implementation reveals a useful
boundary, but their acceptance criteria should not be diluted.

Synthetic encounter work is deliberately outside the v0.2 release-critical
path. Rotation analysis, SimulationCraft integration, a PWA, analytics, and
server-side processing are not part of this plan.

## What the current captures tell us

| Capture | Observed shape | Planning consequence |
| --- | --- | --- |
| `data/dummy-encounter.txt` | 28.9 MB, 89,921 records, about nine minutes, many players, several dummy types and instances, pet/guardian activity, Unicode names, and advanced logging fields | This is the main noisy discovery/filtering fixture. Passing only a small synthetic fixture is insufficient. |
| `data/boss-encounter.txt` | 47 KB, 172 records, two genuine encounter envelopes, `COMBATANT_INFO`, one Unicode-named player, and the same Retail 12.1.0 log profile | This is the reference for encounter metadata and for ensuring genuine encounters are not misclassified as dummy sessions. |
| `data/cleave-logs.txt` | 2.29 MB, 7,462 records, several nearby players, and Pølsefatter activity against five cleave-dummy GUIDs | This is the real multi-target fixture. Pølsefatter has 913 qualifying target records in one continuous 87.413-second window with no internal gap above three seconds. |
| `data/session-splitting.txt` | 1.41 MB, 4,591 records, several nearby players, and Pølsefatter activity against one Dungeoneer's Training Dummy | This is the real gap-splitting fixture. Its confirmed ground truth is four short groups at a 10-second threshold, separated by gaps of 20.264, 33.489, and 25.130 seconds. |

The real environment cannot provide isolated captures without nearby players;
that noise is valid product input rather than a fixture defect. The existing
dummy capture supplies the real single-target and Risen Ghoul ownership case,
while `cleave-logs.txt` and `session-splitting.txt` supply multi-target and gap
coverage. Minimal/isolated, external-effect, and missing ownership variants may
be synthetic, with provenance recorded in the fixture manifest.

## Dependency map

```text
D00 Capture characterization
 ├──────────────┐
 ▼              ▼
D02 Parser     D01 App foundation
 ▼              │
D03 Schemas     ▼
 ├──────────► D04 Streaming worker
 ▼              │
D05 Discovery ◄─┘
 ▼
D06 Extraction and filtering
 ├──────────► D07 Exports
 │              │
 └──────────► D08 Intake and selection UI
                ▼
              D09 Results and export UI
                ▼
              D10 Hardening
                ▼
              D11 Static release

D12 Encounter-envelope research depends on D02-D03, but does not block D11.
```

D00 and D01 can proceed independently. After their contracts settle, the
remaining sequence is intentionally close to the application's two-pass data
flow.

## Cross-cutting definition of deliverable

Every implementation chunk must:

- keep parser/domain code independent of the DOM and UI framework;
- keep combat-log contents local to the browser and introduce no analytics;
- preserve unknown or extra source data rather than silently dropping it;
- add unit, integration, or acceptance tests at the lowest useful layer;
- add a regression fixture for any parsing bug discovered during the chunk;
- keep normal processing streaming—no whole-file `File.text()` plus `split()`;
- expose player-friendly failures while retaining opt-in technical details;
- update relevant documentation when a public contract or observed log format
  changes.

## D00 — Capture characterization and test manifest

**Outcome:** The sample data has documented, repeatable expectations rather than
being an informal pile of example lines.

**Scope**

- Record file size, line count, time range, log/build version, event-type
  distribution, player candidates, dummy candidates, and encounter envelopes.
- Manually label the expected set of player characters and representative
  per-character attempt boundaries in a small manifest. No character is the
  globally intended primary; do not infer golden answers solely from the
  algorithm under test.
- Extract compact, attribution-safe regression fixtures for timestamp, CSV,
  Unicode, advanced fields, unknown events, summons, external effects, and
  encounter metadata. Retain the original captures as end-to-end fixtures.
- Document gaps in the requested Capture A–E set, distinguish real captures from
  synthetic scenarios, and document how either kind should be added.

**Acceptance**

- `docs/test-data.md` explains provenance, purpose, expected results, and any
  privacy/sanitization considerations for every fixture.
- A machine-readable manifest supplies stable expectations without embedding
  the 28.9 MB file into each unit test.
- A repeatable developer command can regenerate descriptive statistics but
  cannot overwrite manually labelled ground truth without an explicit action.

**Verification:** Manifest/schema test plus a capture inventory smoke test.

**Dependencies:** None.

## D01 — Application foundation and stable contracts

**Outcome:** A buildable, strictly typed, testable static application shell
establishes the boundaries between core parser, worker, and UI and enforces its
quality rules before changes are committed.

**Scope**

- Initialize TypeScript, Vite, Vitest, formatting, type-aware linting, and the
  production build.
- Enable TypeScript strict mode plus appropriate additional safety options such
  as `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `useUnknownInCatchVariables`, and `noImplicitOverride`.
- Configure type-aware ESLint rules that reject explicit `any`, unsafe values
  propagated from `any`, unjustified TypeScript suppression comments, and unused
  lint-disable directives. Use `unknown` plus validation/narrowing at untrusted
  boundaries.
- Add committed pre-commit hooks and staged-file tooling for formatting/linting,
  plus a full typecheck before a commit is accepted. Hooks must be installed by
  the normal package setup and work without a developer-specific global tool.
- Provide one `npm run verify` command that runs formatting checks, linting,
  typechecking, and tests; run the same command in a basic CI quality workflow so
  bypassing a local hook cannot bypass repository policy.
- Add a project-appropriate `.gitignore` for Node, Vite, TypeScript, coverage,
  environment, editor, and OS artifacts. Do not use a broad `*.log` rule that
  would hide combat-log fixtures.
- Use React with Vite for the UI and record the boundary in a short architecture
  decision; the core and worker contracts must remain framework-independent.
- Establish directories for `core`, `worker`, `ui`, tests, and documentation.
- Define shared result, warning/error, progress, and parser metadata contracts.
- Render a basic static page with the local-processing privacy statement.

**Acceptance**

- A clean checkout can install, test, build, and preview the app using documented
  commands.
- The production output contains static assets only and makes no network request
  for parsing.
- A smoke test imports core contracts without a browser or DOM environment.
- `npm run verify` passes from a clean checkout, and deliberately introduced
  explicit/unsafe `any` examples fail linting or typechecking.
- The pre-commit hook runs automatically after normal dependency installation;
  its commands are also directly runnable for debugging and CI.

**Verification:** Hook installation smoke test, negative lint fixtures for
explicit/unsafe `any`, `npm run verify`, and production build.

**Dependencies:** None.

## D02 — Incremental line and CSV parser primitives

**Outcome:** Raw Retail combat-log records can be tokenized safely and without
loss, independently of a browser.

**Scope**

- Incremental byte decoding and line splitting across arbitrary chunk
  boundaries, including CRLF and a final unterminated line.
- Timestamp extraction that preserves the raw fractional component and provides
  an exact, timezone-unspecified integer count of 100-microsecond ticks for
  comparison. Milliseconds are derived only where a consumer needs them.
- CSV tokenization for quoted strings, escaped quotes if observed, commas inside
  quotes, empty values, `nil`, hexadecimal text, and Unicode.
- Generic raw record representation retaining the exact source line and all
  fields.
- Explicit parse warnings/failures with source line context.

**Acceptance**

- Chunk boundaries can occur inside a multibyte Unicode character, timestamp,
  quoted field, or line ending without changing the parsed result.
- `Pølsefatter-ArgentDawn-EU`, `nil`, zero GUIDs, hex flags, and original
  timestamp precision survive parsing.
- Malformed records produce a typed warning or fatal error; they do not cause an
  unclassified exception.

**Verification:** Table-driven unit tests, fuzz/property tests for chunking, and
round-trip tests for raw fields.

**Dependencies:** D00 for curated fixtures.

## D03 — Event schemas, actors, and canonical models

**Outcome:** The priority Retail events become normalized `CombatEvent` values,
while unsupported events remain usable generic records.

**Scope**

- Common source/destination header and GUID-based actor classification.
- Event-family schemas for casts, damage, swings/range, auras, resources,
  summons/creates, deaths, `COMBATANT_INFO`, and encounter boundaries listed in
  the spec.
- A first-class `CombatLogSchema` contract and registry. Each schema declares a
  stable ID, compatible project/log/build versions, its event definitions, and
  normalization behaviour; multiple schemas can coexist without conditionals
  spread through parser logic.
- Prefer an exact registered schema; when none matches, select the latest
  installed schema for the same WoW project and mark the selection as a fallback
  in warnings and output metadata.
- Canonical `Actor`, `CombatEvent`, `Session`, `DiscoveryResult`, warning,
  statistics, and parser metadata models.
- `additionalFields`, raw line, origin, schema profile, and parser version
  preservation.
- Semantically equivalent serialization for supported raw records.

**Acceptance**

- Every priority event type observed in the provided captures parses without a
  fatal error.
- An unrecognized event name and an unexpected supported-event field count are
  preserved with warnings and full raw data.
- Naturally occurring `COMBATANT_INFO` is retained; missing data is never
  fabricated.
- Parser models can be consumed in a Node test with no DOM dependency.
- Schema selection is explicit in parser results, and every schema profile can
  run the same conformance suite independently.
- An event that does not fit the selected schema is preserved as a generic raw
  record with a warning when safe. A structural incompatibility produces a typed
  parser failure with line/schema context rather than an application crash.

**Verification:** Event-family unit tests, capture-wide parser smoke tests, and
semantic parse/serialize/parse tests.

**Dependencies:** D02.

## D04 — Browser streaming worker and operation lifecycle

**Outcome:** A large browser `File` can be scanned off the main thread with real
progress and reliable cancellation.

**Scope**

- Typed `DISCOVER_FILE`, `PROCESS_SESSION`, `CANCEL`, progress, completion, and
  error messages.
- Initial sample validation based on contents rather than filename.
- Streaming `Blob`/`File` reads through the D02 line pipeline.
- Byte-based progress with truthful phases.
- Cancellation by worker reset or cooperative abort, followed by a reusable app
  state.
- A thin main-thread client that prevents stale results from a cancelled or
  superseded operation.

**Acceptance**

- The noisy capture is scanned without whole-file text loading and the page's
  main thread remains interactive.
- Progress is monotonic within a phase and ends at the actual processed byte
  count.
- Cancelling during discovery and extraction prevents a completion result; a
  subsequent operation succeeds without reloading the page.
- Empty, unreadable, unrelated, and invalid files map to documented user-facing
  error categories.

**Verification:** Worker integration tests, cancellation race tests, and a
browser smoke test using the noisy capture.

**Dependencies:** D01-D03.

## D05 — Pass-one player, target, and session discovery

**Outcome:** The first pass returns a small ranked set of characters, targets,
and candidate attempts without retaining all events.

**Scope**

- Lightweight scanning fields only: timestamp, type, actors, and minimal
  interaction/damage data.
- Player activity ranking based on outgoing casts/damage, duration, consistency,
  and target interactions.
- Recorder-character detection requires a player GUID/type plus
  `AFFILIATION_MINE`; exactly one matching player may be proposed to the UI,
  while zero or multiple matches require normal selection.
- Target ranking based on sustained interaction and GUID/behaviour evidence,
  without relying solely on an English dummy name.
- Per-player active windows using a boundary hierarchy: schema-defined explicit
  combat boundaries when present, otherwise gaps between qualifying hostile
  actions. Collect all affected targets into the resulting session so both
  single-target and cleave attempts are valid.
- A `SessionDiscoveryOptions.inactivityThresholdMs` setting with a 10-second
  default. The algorithm consumes this option rather than embedding the value.
- Configurable, explainable confidence tiers plus reason codes. “Likely” defaults
  to at least 20 seconds and two player-initiated hostile actions. One explicit
  player-initiated hostile action is enough for “Possible”; periodic and owned-
  entity activity may extend a group but cannot establish intent alone. Genuine
  encounter windows are excluded from the normal dummy-session list.
- Bounded aggregate state whose size tracks actors and candidate windows rather
  than line count.

**Acceptance**

- Every labelled player character from D00 is discoverable, and representative
  per-character single-target and multi-target attempts appear in the expected
  order or within documented confidence tolerances.
- Changing the selected character yields that character's sessions, not a global
  list assembled from nearby players.
- A 27–30 second gap creates separate sessions; short rotational gaps do not.
- Only qualifying hostile actions by the selected player or a detected owned
  entity keep a session active; self-buffs, heals, resource events, failed casts,
  and unrelated incoming effects do not bridge sessions.
- The two genuine boss envelopes are recognized as encounters and are not
  offered as high-confidence training attempts.
- Discovery output stays compact on the noisy capture and contains no full event
  list.

**Verification:** Deterministic scoring tests, session-boundary tests, manifest
golden tests, and a retained-state size assertion.

**Dependencies:** D00, D03, D04's streaming interface. Core discovery logic may
be developed before its worker integration lands.

## D06 — Pass-two extraction, ownership, and filtering

**Implementation:** Complete on the current branch.

**Outcome:** One selected attempt becomes the clean canonical `Session` that is
the product's primary data asset.

**Scope**

- Reread the original file, skip cheaply before a five-second pre-roll, fully
  parse the selected window, and stop after a five-second post-roll.
- Model the session target as a set of one or more actors, retaining per-target
  statistics and an optional inferred primary/focus target without requiring
  one to exist.
- Build an actor/ownership graph from player, pet, guardian, summon, create, and
  other observed ownership signals.
- Treat `COMBATLOG_OBJECT_AFFILIATION_MINE` as establishing a controlled-by-
  primary relationship because the product assumes the selected character
  recorded their own log. Explicit advanced owner GUIDs and summon/create edges
  take precedence and validate that assumption.
- Apply relevance rules for the primary player, owned entities, session targets,
  incoming activity, and necessary metadata.
- Retain and mark external effects applied by unrelated actors to the selected
  player or owned entities.
- Produce relative timestamps, warnings, event/statistics summaries, filtering
  audit counts, and optional per-line debug decisions.
- Guard against unusually large/overlapping selections with a typed warning or
  configurable retained-data budgets rather than a page crash. Crossing the
  soft budget warns and continues; crossing the hard budget stops with a
  recoverable error. Sessions are never silently truncated.

**Acceptance**

- The selected player's relevant casts, damage, incoming effects, and detected
  controlled-entity activity are present in chronological order for both
  single-target and multi-target attempts.
- Entities marked `AFFILIATION_MINE` are retained as controlled by the selected
  recording character unless stronger ownership data contradicts that edge; a
  contradiction produces a warning with both evidence sources.
- Nearby players' unrelated activity is absent.
- Every considered record is represented in kept/removed audit totals; debug
  mode can explain a sample decision.
- Visible session duration uses the selected activity window, not the pre/post
  state-reconstruction window.
- Extraction stops after post-roll instead of reading the rest of a longer log.
- Soft and hard limits can be overridden through an explicit advanced retry;
  defaults are measured and documented during D10 rather than embedded as
  unexplained universal values.

**Verification:** Filtering truth tables, ownership graph tests, external-effect
tests, audit-accounting invariants, and an end-to-end noisy-capture golden test.

**Dependencies:** D03-D05.

## D07 — JSON and filtered raw-log exports

**Implementation:** Complete on the current branch.

**Outcome:** A processed session can be downloaded locally in both canonical and
source-compatible forms.

**Scope**

- Versioned `session.json` serialization with parser/schema metadata.
- `session.filtered.log` from retained original lines in original chronological
  order.
- Browser `Blob` download generation and safe, deterministic filenames.
- Export warnings and size protection where generation may be expensive.

**Acceptance**

- JSON validates against its documented schema and can be parsed back into a
  semantically equivalent session.
- Filtered raw output does not rewrite retained source records and reparses
  without new fatal errors.
- Export generation makes no network request and does not persist contents in
  local storage, IndexedDB, or cookies.

**Verification:** JSON schema/round-trip tests, byte-for-byte raw-line tests, and
browser download integration tests.

**Dependencies:** D06.

## D08 — File intake, discovery, and selection UI

**Implementation:** Complete on the current branch.

**Outcome:** A non-technical player can go from opening the page to choosing a
detected attempt.

**Scope**

- Explicit UI state machine for waiting, validation/scanning, character
  selection, and session selection.
- Keyboard-accessible file picker plus drag-and-drop.
- Local-processing/privacy message, file summary, real progress, and cancel.
- Present every deduplicated player character found in the file. When exactly
  one player GUID/type carries `AFFILIATION_MINE`, preselect it and show a
  confirmation with Continue and Change Character. Zero or multiple matches
  require explicit selection; no valid character is hidden.
- Session cards with target, time range, duration, damage, and confidence wording
  without GUIDs in normal mode.
- Show likely attempts first and uncertain but substantive groups under “Other
  possible sessions.” Isolated incidental interactions remain available only in
  advanced/debug output.
- Helpful no-player/no-session/invalid-file recovery states.

**Acceptance**

- Happy path and multiple-player flows reach a selected session using the noisy
  capture.
- The supplied captures preselect Pølsefatter from the mine flag; synthetic zero-
  match and multiple-match cases display the full selection UI.
- Cancelling or choosing a replacement file returns to a coherent state and
  stale worker messages cannot advance the UI.
- All controls work with a keyboard, progress has textual status, and meaning is
  not conveyed by colour alone.

**Verification:** UI state reducer tests, component tests, and browser acceptance
tests through session selection.

**Dependencies:** D01, D04, D05.

## D09 — Processing, summary, and export UI

**Implementation:** Complete on the current branch.

**Outcome:** The selected attempt can be processed, reviewed, and exported in a
complete end-to-end workflow.

**Scope**

- Detailed-processing progress and cancellation.
- Session summary for character, target set, range, duration, relevant/removed
  event counts, controlled entities, external effects, unknown types, and
  warnings.
- JSON and filtered-log export actions.
- Progressive technical details/debug information without exposing GUIDs by
  default.
- Reset/select-another-file and select-another-session paths.

**Acceptance**

- The complete happy path works without terminal knowledge: select file, choose
  character/session, process, review, and export.
- Warnings are understandable, non-fatal warnings do not block valid exports,
  and fatal errors offer a recovery action.
- Refresh may reset the app; no log/session contents are encoded in the URL or
  persisted by the application.

**Verification:** End-to-end happy path, cancellation, warning, fatal error, and
export tests.

**Dependencies:** D06-D08.

## D10 — Performance, compatibility, and accessibility hardening

**Implementation:** Complete on the current branch. Evidence and limitations
are recorded in [`d10-hardening.md`](d10-hardening.md).

**Outcome:** The complete workflow meets v0.2's quality claims on realistic data
and supported desktop browsers.

**Scope**

- Profile first-pass CPU, main-thread responsiveness, retained state, and
  second-pass early stopping with both provided captures.
- Add regression budgets that detect accidental whole-file retention or full
  event construction during discovery.
- Exercise current Chrome, Edge, Firefox, and Safari; document unavoidable
  differences and graceful mobile behaviour.
- Complete keyboard, semantic-control, focus, progress announcement, contrast,
  and non-colour communication review.
- Verify the built app emits no combat-data network requests and contains no
  analytics/storage code paths.

**Acceptance**

- The noisy capture completes the full flow without UI lock-up or page failure
  on supported desktop browsers.
- Evidence demonstrates discovery memory tracks aggregate discovery state, and
  extraction memory tracks the selected window, rather than total file size.
- Automated accessibility checks pass, with documented manual checks for the
  file picker, progress, cancellation, and errors.
- Any numeric performance baselines established here are recorded with browser,
  hardware, fixture, and measurement method; they do not become unexplained
  universal promises.

**Verification:** Browser matrix, performance harness, memory/retention
assertions, accessibility automation, and manual checklist.

**Dependencies:** D09.

## D11 — GitHub Pages release

**Implementation:** Release automation and local repository-scoped validation
are complete on the current working tree. First deployment and its signed
external evidence remain pending because GitHub Pages is currently disabled and
the expected public URL returns 404. See
[`d11-release-checklist.md`](d11-release-checklist.md).

**Outcome:** v0.2 is available from a static URL with a repeatable release
process.

**Scope**

- GitHub Actions test/build/deploy workflow.
- GitHub Pages base-path and direct-load asset validation.
- Visible privacy statement and concise user instructions.
- Release checklist tied to the spec's v0.2 definition of done.
- Documented rollback and local reproduction of the production build.

**Acceptance**

- A clean CI run publishes immutable static assets with no runtime backend.
- The deployed URL completes the happy path in at least one Chromium, Firefox,
  and WebKit-family browser.
- Browser network inspection confirms combat data is never uploaded.
- Every item in the v0.2 coverage matrix below is either satisfied or explicitly
  accepted as a release exception.

**Verification:** CI checks, deployed smoke test, and signed release checklist.

**Dependencies:** D10.

## D12 — Experimental encounter-envelope research

**Outcome:** Current Retail encounter metadata is documented well enough to make
an informed decision about a future synthetic export.

**Scope**

- Compare the two boss envelopes with dummy activity from the same 12.1.0
  profile, including ordering, field counts, `COMBATANT_INFO`, and nearby events.
- Add a development-only comparison report/tool.
- Document what can be preserved, what would have to be synthesized, and what
  must not be fabricated.
- If an experimental serializer follows, mark generated records internally as
  synthetic and keep the feature behind Advanced/Experimental.

**Acceptance**

- `docs/retail-log-format.md` answers the research questions in spec section 41
  with evidence from the captures.
- The research does not assign a real encounter ID to impersonate a boss kill
  and does not claim Warcraft Logs compatibility.
- No absent `COMBATANT_INFO` is fabricated.

**Verification:** Deterministic comparison snapshot and documentation review.

**Dependencies:** D02-D03. Not a dependency of D11.

## v0.2 coverage matrix

| Capability | Owning chunk(s) |
| --- | --- |
| Static browser app and local-only privacy model | D01, D11 |
| Streaming, responsive, cancellable parsing with progress | D02, D04, D10 |
| Current Retail parsing, Unicode, unknown-event tolerance | D02, D03 |
| Character, target, and attempt discovery/splitting | D05 |
| Detailed reparse, ownership, external effects, filtering | D06 |
| Normalized JSON and filtered raw log | D07 |
| Non-technical end-to-end workflow and errors | D08, D09 |
| Automated parser tests independent of UI | D00, D02, D03, D05-D07 |
| Accessibility and supported-browser confidence | D08-D10 |
| GitHub Pages production release | D11 |
| Synthetic encounter investigation | D12, post-release/experimental |

## Decisions and evidence still needed

These items should be resolved in the owning chunk and recorded as an ADR,
fixture label, or test—not left as undocumented implementation assumptions:

None for D00-D10. D11's local decisions and validation are now recorded. Its
remaining evidence is external: a pushed successful Pages workflow, the
returned deployed URL, post-deployment proxy-engine smoke results, and
repository-owner sign-off.

The D05 defaults are now validated: the 10-second threshold produces the four
approved split groups and preserves the 87.413-second cleave group, while the
20-second/two-intent/sustained-activity defaults classify substantive continuous
attempts as Likely and short approved split groups as Possible.

## Decisions made

### Character selection

Pass one returns every deduplicated player character present in the log. If
exactly one actor has a player GUID/type and `AFFILIATION_MINE`, the UI preselects
it as the recording character and asks for confirmation, offering Continue and
Change Character. If no player or multiple players match—such as a concatenated
log spanning several locally recorded characters—the UI requires explicit
selection from the complete list. Confirmation or manual selection establishes
the primary character for target/session discovery and extraction; heuristics
never remove valid characters.

### UI framework and static hosting

The UI uses React with Vite. React is confined to presentation and application
state; parser and worker packages remain framework-independent TypeScript. The
production build consists only of static assets and is deployed to GitHub Pages.
Vite's asset base path must be configured and tested for the repository-scoped
Pages URL.

### Timestamp precision

Combat-log timestamps are kept verbatim and parsed into an exact integer count
of 100-microsecond ticks for ordering and duration calculations. Their calendar
date/time is timezone-unspecified because the log supplies no offset. Whole or
floating-point milliseconds are derived values and never the canonical ordering
key, so the fourth fractional digit is not discarded.

### Versioned combat-log schemas

Combat-log schemas are first-class, well-defined entities selected by the
parser. A schema has a stable ID, compatibility metadata for WoW project, combat
log version, and build range, plus its event definitions and normalization
logic. Schemas are registered rather than embedded as version checks throughout
the parser, allowing several WoW versions to coexist and run an identical
conformance suite. The selected schema ID is included in parser/session output.

Schema selection prefers an exact registered match. If none exists, the parser
uses the latest installed schema for the same WoW project, records that fallback
in output metadata, and presents a warning. Per-event mismatches are retained as
generic raw records when safe. If the selected schema cannot interpret the
record structure reliably, parsing ends with a typed, user-recoverable error and
technical schema/line context rather than an unhandled failure. A developer-mode
manual override remains available for schema testing.

### Session discovery presentation and boundary hierarchy

After character selection, the normal UI shows all meaningful activity-session
groups: likely attempts first, then uncertain but substantive groups under
“Other possible sessions.” Isolated incidental interactions are restricted to
advanced/debug output. A group is scoped to the selected player plus detected
owned entities and contains the set of targets affected during that activity
window. Target count is descriptive—single-target and multi-target/cleave
attempts are equally valid—and does not reduce confidence.

Schemas may declare explicit combat boundary records when a log version provides
them. No generic combat-start/combat-end marker appears in either supplied
capture, so the current Retail schema must fall back to gaps between qualifying
hostile actions. Encounter envelopes, target death/destruction, zone/log
boundaries, and backwards timestamps are hard boundaries where applicable.
Self-buffs, heals, resource changes, failed casts, and unrelated incoming events
do not reset the inactivity timer. Pre-roll and post-roll used for state
reconstruction do not change the displayed group boundary.

The inactivity threshold is supplied through `SessionDiscoveryOptions` and
defaults to 10 seconds. It is never hard-coded inside sessionization logic, so
tests, developer tooling, and an advanced UI control can override it without
changing the normal zero-configuration workflow.

Confidence describes whether a group is a deliberate training attempt, not how
many targets it contains. “Likely” defaults to a duration of at least 20 seconds,
at least two player-initiated hostile actions, sustained qualifying activity,
and no genuine encounter envelope. “Possible” requires at least one explicit
player-initiated hostile action but may be short, sparse, or have uncertain
training-target evidence. “Incidental” groups contain only passive periodic,
owned-entity, or secondary-area activity and appear only in advanced/debug
output. These thresholds are configuration values and carry reason codes;
periodic damage and owned-entity activity can extend a group but cannot establish
intent by themselves.

### Controlled-entity ownership

The product assumes a user supplies a combat log recorded by the character they
select. Consequently, the combat-log `AFFILIATION_MINE` flag establishes a
controlled-by-primary relationship for non-player actors during the applicable
activity window. This covers pets, guardians, totems/objects, and temporary
control. Explicit advanced-log owner GUIDs and `SPELL_SUMMON`/`SPELL_CREATE`
relationships remain stronger evidence and are used to validate and enrich the
edge. If stronger evidence contradicts the mine-derived owner, the parser keeps
the stronger edge and emits an ownership-conflict warning; names alone never
establish ownership.

### Abnormally large sessions

Extraction enforces configurable soft and hard budgets based on estimated
retained bytes and event count. Crossing the soft budget emits a visible warning
while processing continues. Crossing the hard budget stops cleanly with a
recoverable error and offers a narrower selection or an explicit Advanced retry
with a higher limit. The parser never returns a silently truncated `Session`.
Default values are set from the D10 browser/performance evidence and recorded
with the fixture, browser, hardware, and measurement method.

D10 measured 5,210 retained events, 1,395,641 retained source bytes, and a
24,494,536-byte JSON export for the largest approved selected window. Defaults
are therefore 25,000/50,000 retained events, 16/32 MiB retained source bytes,
and 128/256 MiB complete export bytes for soft/hard behavior respectively.
They are attempt-retention safety boundaries rather than source-file limits or
universal product promises. Full evidence is in
[`d10-hardening.md`](d10-hardening.md).

### Real and synthetic fixture coverage

Real captures are not required to be isolated from nearby players. The release
set uses the existing noisy log as the real single-target and Risen Ghoul
ownership case, `cleave-logs.txt` as the real cleave attempt,
`session-splitting.txt` as the real inactivity-gap case, and the existing genuine
boss capture for encounter envelopes. Synthetic fixtures cover minimal/isolated
records, external buffs, and ownership variants that cannot be recorded
conveniently. Every fixture declares whether it is real, derived, or synthetic;
synthetic data does not masquerade as a real capture.

### Static Pages release

The D11 artifact is an exact four-file Vite build: `index.html`, one hashed CSS
entry, one hashed application module, and one separately emitted hashed parser
worker. Relative entry and worker resolution is validated at the repository
path, and any additional artifact file—including maps, captures, environment
files, or secret material—fails release validation. Both the Quality workflow
and Pages workflow run `npm run verify`, the production build, the production
privacy audit, and the Pages artifact audit. Deployment additionally gates on
the repository-scoped Playwright proxy matrix and follows with a deployed-URL
direct-load and complete real-cleave/export/privacy smoke.

GitHub Pages repository enablement is not inferred from local code. At the D11
implementation checkpoint public metadata reported `has_pages: false` and the
expected URL returned HTTP 404. The owner must enable GitHub Actions as the
Pages source before the first run, run the workflow, and complete the signed
evidence record in [`d11-release-checklist.md`](d11-release-checklist.md).
Playwright Firefox/WebKit remain proxies and do not change D10's actual-browser
gaps.

## Suggested first implementation slice

Start with D00 and D01. They remove ambiguity from both sides of the system:
D00 establishes what correct behaviour means for the supplied data, while D01
establishes where the parser, worker, and UI contracts live. Then deliver D02
and D03 before implementing heuristics; discovery results are only trustworthy
when the underlying records are parsed and preserved consistently.
