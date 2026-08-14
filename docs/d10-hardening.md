# D10 performance, compatibility, accessibility, and privacy evidence

- **Measured:** 2026-08-14
- **Scope:** D10 only; no deployment, release automation, PWA, analytics, or
  backend work is included.

## Measurement environment and method

The local measurement host was a MacBook Pro (Mac17,2), Apple M5 with 10 cores
(4 performance and 6 efficiency), 24 GB RAM, macOS 26.5 (25F71), Node
24.18.0, Vitest 4.1.10, and Playwright 1.62.1. Serial numbers and machine
identifiers are intentionally not recorded.

`npm run test:performance:profile` runs the explicitly named capture-wide
profile in one Vitest worker. It streams each file with `createReadStream`, uses
`performance.now()` for wall time and `process.cpuUsage()` for user/system CPU
time, and reports source bytes, records, structural retained-state counters,
selected-window records, retained events/source bytes, exports, and early-stop
state. These are development-machine observations, not universal performance
promises. CPU time may exceed wall time because runtime work can use more than
one OS execution context.

The browser smoke uses the production build, the real 28.88 MB noisy capture,
a 25 ms main-thread heartbeat, native file input, the production Web Worker,
and the first likely recorder session. Browser CPU time is not available from
the portable Playwright API, so only wall time and responsiveness are recorded.

## Pass-one discovery profile

| Real fixture               |      Source / records | Retained actors | Targets | Candidate windows | Owned observations | Encounter envelopes | Retained events / raw lines |      Wall | CPU user / system |
| -------------------------- | --------------------: | --------------: | ------: | ----------------: | -----------------: | ------------------: | --------------------------: | --------: | ----------------: |
| `data/cleave-logs.txt`     |   2,290,979 B / 7,462 |              20 |      13 |                 5 |                  7 |                   0 |                       0 / 0 |  27.95 ms |   51.88 / 2.66 ms |
| `data/dummy-encounter.txt` | 28,880,428 B / 89,921 |             727 |      90 |                30 |                628 |                   0 |                       0 / 0 | 198.70 ms | 227.75 / 11.72 ms |

Both scans read exactly the complete source because discovery must inventory
the complete log. The retained totals are 45 and 1,475 aggregate entries,
respectively, while record counts are 7,462 and 89,921. The noisy capture's 628
ownership observations reflect its many actual summon records. No retained
counter is event-count-derived, and the schema-normalization spy proves pass one
never calls the full `CombatEvent` normalizer.

This is the bounded-state claim: additional repeated combat events increment
aggregate values but are not retained; state grows when a new actor, target,
ownership observation, encounter, or candidate window is discovered. The
regression suite requires both full-event and raw-line retained counts to remain
zero and aggregate count to remain below one tenth of scanned records on the
real profiles.

Those aggregates and the incremental decoder are the scanner's only owned
state; completed source lines become unreachable after `consume`. The counters
are therefore a deterministic proxy for algorithm-owned memory growth. A raw
process-heap delta is intentionally not used as a gate because Vitest, V8
allocation arenas, garbage-collection timing, and file-stream buffers would
make it a machine-state measurement rather than a retention invariant.

## Pass-two extraction and export profile

| Approved real selection |       Source |   Bytes read | Reconstruction records | Retained events / source bytes | Early stop |   JSON / filtered export |      Wall | CPU user / system |
| ----------------------- | -----------: | -----------: | ---------------------: | -----------------------------: | ---------- | -----------------------: | --------: | ----------------: |
| Noisy single target     | 28,880,428 B | 11,272,192 B |                 35,705 |            5,210 / 1,395,641 B | yes        | 24,494,536 / 1,395,641 B | 190.40 ms | 419.41 / 26.87 ms |
| Five-target cleave      |  2,290,979 B |  2,097,152 B |                  6,703 |              1,610 / 478,114 B | yes        |    8,304,632 / 478,114 B |  34.62 ms |   69.00 / 1.90 ms |

The reconstruction record count is the complete raw-record collection for the
inclusive five-second pre-roll through post-roll only. Pass two cheaply
timestamp-skips earlier lines, constructs full records only for that bounded
window, filters after ownership resolution, and stops the input reader on the
first later timestamp. It does not retain the remainder of either file. The
filtered export equals the retained raw-line byte estimate because it preserves
those source lines exactly; JSON is larger because it includes normalized and
lossless source representations.

In installed Google Chrome, the large-capture discovery completed in 321.2 ms;
the 25 ms heartbeat fired 12 times and its largest gap was 27.2 ms. Processing
the first likely discovery session reached the result in 38.6 ms after the UI
reported 12.0 MB read rather than the 28.88 MB source. Playwright Chromium
proxy measured 220.0 ms discovery, 26.0 ms maximum heartbeat gap, and 34.6 ms
to the extraction result on the same host. These values are smoke evidence,
not CI timing gates; the enforced gate is a deliberately loose 500 ms maximum
heartbeat gap so scheduling noise does not create a false performance promise.

## Measured defaults

The largest approved selected session retained 5,210 events and 1,395,641 raw
source bytes and generated 24,494,536 bytes of JSON. D10 therefore installs:

| Limit                 | Soft warning | Hard recoverable failure | Evidence multiple at the largest approved session |
| --------------------- | -----------: | -----------------------: | ------------------------------------------------: |
| Retained events       |       25,000 |                   50,000 |                                       4.8× / 9.6× |
| Retained source bytes |       16 MiB |                   32 MiB |                                     12.0× / 24.0× |
| Complete export bytes |      128 MiB |                  256 MiB |                                      5.5× / 11.0× |

These protect retained attempt size, not total input-file size. They are
desktop-browser safety boundaries justified by the current capture and machine,
not universal limits on valid WoW logs. Supplying an explicit `budgets` or
`sizeLimits` object replaces the corresponding default set. A soft crossing
warns once and returns the complete session/export. A hard crossing returns a
typed `session-too-large` error and no partial session/export; nothing is
silently truncated.

## Browser coverage

The production workflow uses the real five-target capture and covers file →
discovery → recorder confirmation → session selection → processing → summary →
both downloads, technical disclosure, accessible states, and the local-only
audit.

| Coverage                        | Version exercised                                                             | Result                            | What it does and does not mean                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Installed Google Chrome channel | binary 151.0.7922.138; headless UA reduces this to `HeadlessChrome/151.0.0.0` | 6/6 passed                        | Genuine installed Chrome binary in headless mode; includes large capture, discovery/processing cancellation, mobile-sized layout, axe, downloads, and privacy audit.                                   |
| Playwright Chromium proxy       | Chrome for Testing 151.0.7922.34                                              | 6/6 passed                        | Chromium-family proxy, not installed Chrome or Edge.                                                                                                                                                   |
| Playwright Firefox proxy        | Firefox 153.0                                                                 | 4 passed, 2 intentionally skipped | Complete real cleave workflow, recovery, mobile, axe, downloads, and privacy. Large noisy timing/cancellation smoke is covered by deterministic worker tests and Chromium runs. Not installed Firefox. |
| Playwright WebKit proxy         | WebKit reporting Safari 26.5                                                  | 4 passed, 2 intentionally skipped | Complete real cleave workflow, recovery, mobile, axe, downloads, and privacy. It is not the installed Safari application.                                                                              |

Actual Microsoft Edge and Firefox were not installed and were not exercised.
Safari 26.5 (21624.2.5.11.4) was present, but Playwright does not automate the
installed Safari application; WebKit is only a proxy. Consequently the product
still has genuine Chrome evidence plus engine-proxy evidence, not a claim of
actual Edge/Firefox/Safari certification. A manual GUI and assistive-technology
pass remains release evidence to collect on those applications.

No browser-specific fallback was added because the exercised engines agreed on
File/Blob streaming, workers, downloads, and controls. One production-build
defect was demonstrated and fixed: Vite requires the literal
`new Worker(new URL(..., import.meta.url))` shape to emit a worker chunk. The
build audit now requires exactly one separate parser-worker asset.

## Accessibility review

axe-core 4.13.0 reports zero violations in waiting, recorder-confirmation,
session-selection, result/technical-detail, and recoverable-error states in the
installed Chrome run and Chromium/Firefox/WebKit proxy workflows. This includes
automated contrast rules. The 390 × 844 smoke has no horizontal overflow and
keeps file/continue controls visible in all four projects.

The keyboard/semantics review confirmed:

- the native file chooser opens with keyboard Enter; drag-and-drop is optional;
- native buttons, forms, fieldsets, radio inputs, details/summary, progress,
  headings, status, and alert semantics are used with accessible names;
- each workflow heading receives focus after state changes;
- the progress bar has an accessible name, exact visible bytes/percentage, and
  a polite atomic status announcement quantized to ten-percent steps so every
  stream chunk is not announced;
- cancellation, retry, file replacement, both exports, and disclosures are
  keyboard controls;
- scrollable warning/error/technical preformatted regions are focusable;
- warnings and errors include explicit headings and text, status/alert roles,
  and border/text cues, so meaning is not colour-only.

Automated checks cannot establish screen-reader phrasing quality, zoom/reflow
beyond the tested narrow viewport, or subjective focus-order comfort. No manual
VoiceOver, NVDA, JAWS, or high-contrast-mode session was performed; those are
documented compatibility gaps rather than implied passes.

## Privacy and production audit

`npm run audit:production` requires a static HTML/CSS/JavaScript-only build and
one separately emitted parser worker. It rejects application runtime paths for
fetch/XHR/WebSocket/EventSource/sendBeacon, local/session storage, IndexedDB,
cookie mutation, service-worker registration, or History URL mutation. Vite's
unused fetch-based modulepreload polyfill is disabled. React's inert W3C
namespace and error-documentation strings are allowed; they are not request
paths.

The real browser workflow observes requests after file intake. The only
permitted activity is bodyless same-origin GET loading of the emitted static
worker asset; there are no POST bodies and no player GUID, creature GUID, name,
or combat data in a request URL. After both exports, the page URL remains `/`,
localStorage/sessionStorage are empty, IndexedDB has no databases, cookies are
empty, and no service-worker registration exists. Downloads use temporary
`blob:` object URLs that are revoked and do not transmit data.

## Regression routing

- `npm test` is the ordinary compact unit/component suite and excludes every
  large real capture.
- `npm run test:capture-wide` is the explicitly named real-capture parser,
  discovery, extraction, and worker smoke suite.
- `npm run test:performance` enforces structural retention, early stopping, and
  export profile invariants; `npm run test:performance:profile` prints evidence.
- `npm run test:browser:proxies` and `npm run test:browser:chrome` run the
  production browser/accessibility suites.
- `npm run audit:production` audits an existing `dist`; `npm run build` creates
  it.

D11 reuses this evidence without relabelling it. Its Pages workflow adds an
exact artifact allowlist and repository-scoped/deployed proxy-engine smoke, but
does not turn Playwright Firefox or WebKit into installed Firefox or Safari
certification. Release-specific evidence and pending external sign-off are in
[`d11-release-checklist.md`](d11-release-checklist.md).

The regressions cover whole-file/event retention, discovery normalization,
post-roll early stopping, truthful cumulative byte progress, separate worker
emission/main-thread responsiveness, cancellation and stale completion,
replacement/retry/no-session recovery, explicit multi-character selection,
recorder confirmation, five-target output, technical disclosure, both
downloads, accessibility, and local-only behavior.
