# Converter UI workflow

This document records the concrete React behavior. The product is presented as
a focused WoW dummy-log converter: its primary job is to create and download a
simulated encounter log for use with encounter analysis tools. React owns
presentation and application state only. It retains the selected `File` as an
opaque browser handle and delegates both passes to `ParserWorkerClient`; it does
not read, parse, extract, filter, or serialize combat-log content.

## State machine

`src/ui/analyzerMachine.ts` is the pure reducer used by the application and by
transition tests. Its states are:

| State                 | User-visible behavior                                                                                                   | Available exits                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `waiting`             | Converter headline, compact drop area, keyboard-operable file button, one trust line, and a short four-step usage guide | Choose or drop a file                                                      |
| `discovering`         | Concise phase, percentage, native progress element, Cancel, and Start over                                              | Discovery result, recoverable error, Cancel, or Start over                 |
| `character-selection` | Every deduplicated player is a radio option when the recorder cannot be uniquely identified                             | Select one and continue, or Start over                                     |
| `session-selection`   | Attempts for the selected player, each with a direct action; skipped when exactly one Likely attempt can be used safely | Process one attempt, change character, or Start over                       |
| `processing`          | Concise, truthful extraction/filtering/result-building phase and percentage                                             | Result, recoverable error, Cancel, or Start over                           |
| `result`              | Encounter-log download first, essential character/duration/target context, and closed attempt/technical details         | Export or choose another attempt/file                                      |
| `error`               | Player-facing category/message/action and optional technical details                                                    | Retry the same operation, return to attempts where possible, or Start over |
| `cancelled`           | Explicit confirmation that no partial/late result will be used                                                          | Rescan the file or return to attempt selection                             |

Every discovery and processing action has a UI operation ID. Progress,
completion, and failure actions are accepted only while the matching operation
is active. Starting over, cancelling, or retrying changes the active
ID before an old promise can settle. This is independent of, and complementary
to, the stale-message guards in `ParserWorkerClient` and the worker runtime.

## Intake, selection, and accessibility

The file input has an accessible name and is activated by a normal button, so it
works without drag-and-drop and with keyboard activation. The drop area is an
additional pointer interaction, not the only intake method. There is no
filename or MIME-type rejection in React; worker validation inspects contents.
The landing intake contains the single trust statement “Processed locally.
Nothing is uploaded.” It is not repeated after a file has been selected. The
page has no standalone product header or “Browser only” badge above the task.
Below the intake, a compact ordered guide explains the complete handoff: upload
the target-dummy log, download the transformed `.txt`, upload it to Warcraft
Logs with the Archon desktop client, then use the resulting Warcraft Logs link
in an encounter analysis tool. The guide disappears when file processing begins.

After intake, the current-file bar offers **Start over**. It cancels active work,
clears the workflow state, and returns to the landing drop area. It deliberately
does not open the operating system's file picker, so the next file may be either
dropped onto the page or chosen normally.

Progress displays a concise phase label and a percentage calculated from exact
processed and total byte counts. The named native progress element retains the
exact values for assistive technology. State headings receive programmatic
focus after a state change. Forms, fieldsets, radio inputs, buttons, progress,
headings, descriptions, status messages, and alerts use semantic elements, and
warning/error meaning is written in text rather than encoded only by colour.

When discovery has exactly one `proposedRecorderGuid` that still exists in the
player list, the reducer proceeds directly to that character's attempts.
Missing, stale, zero-match, or multiple-match proposals use explicit character
selection. The complete player list remains available through **Change
character**.

Once a character is known, exactly one Likely attempt is processed
automatically. If there are multiple Likely attempts, or only
Possible/Incidental interactions, the selection view remains visible. Each
attempt card directly starts processing through **Use this attempt**; there is
no radio-selection-plus-confirmation step.

Attempt cards show the information needed to choose:
recommendation/confidence, start time, exact duration, and target name or count.
Ranking reasons are inside a closed **Why this attempt?** disclosure. GUIDs are
not rendered as normal labels. Likely and Possible attempts are separate groups;
Incidental interactions, if an advanced discovery caller requested them, are
inside a closed Advanced detail. No manual time-range control is present.

If a selected player has no Likely or Possible session, the screen explains how
to produce a clearer attempt and still offers character/file changes. Empty,
unreadable, invalid, unsupported, no-player, oversized, and internal failures
use the worker's typed `AppError` message and suggested action with technical
context behind a detail disclosure.

## Result and export behavior

The result leads with the selected character, exact duration, target name or
count, and the primary **Download encounter log** action.
Discovery/extraction warnings remain visible when present. Start time,
relevant/removed counts, per-target statistics, and controlled entities are
inside a closed **View attempt details** disclosure. Actor/target GUIDs,
parser/schema metadata, complete statistics, warning context, and optional
filtering debug decisions are further confined to a closed **Technical details**
disclosure.

The public interface exposes only the encounter-log export. It calls the
existing core serializer through `createSessionDownload`. The versioned JSON
serializer and `SessionExportKind` support remain internal core/transport
capabilities; no JSON download action is presented to users. The browser-side
`saveSessionDownload` helper creates an object URL, triggers the deterministic
filename through a temporary anchor, removes that anchor, and revokes the URL in
a `finally` block. Soft serializer warnings remain visible after the download.
A hard serializer failure creates no download and is displayed as a recoverable
alert.

The encounter-log button produces the verified WowCoach-compatible form:
Blackwing Lair zone/map context, a Razorgore wipe envelope, fixed reference
`COMBATANT_INFO`, and transposed selected-target identity, hostile flags, and
advanced map IDs. The fixed character template produces a visible warning.

## Verification boundary

Pure reducer tests cover valid transitions, invalid/stale actions, cancellation,
retry, start-over reset, export feedback, and reset. jsdom component tests cover
keyboard/drop intake, automatic-recorder and explicit-character paths,
automatic single-attempt processing, ambiguous attempt actions, grouping,
multi-target rendering, progress, errors, cancellation, retries, the full
file-to-encounter-export flow, focus movement, semantic names, and URL
revocation. The
repository now configures a D10 production Playwright runner with
installed-Chrome and Playwright Chromium/Firefox/WebKit projects plus axe-core.
The real five-target capture completes the full workflow and encounter-log
download in every project. The large noisy capture is confined to explicitly named
Chromium/installed-Chrome smoke tests; ordinary UI tests continue to use compact
synthetic objects and never load `data/dummy-encounter.txt`.

Progress separates exact visual output from announcements: a named native
progress element shows exact bytes/percentage, while a polite atomic status
announces phase and ten-percent steps. State headings receive focus, errors use
an alert, warnings use a status, and scrollable technical output is keyboard
focusable. axe reports zero violations across waiting, selection,
result/details, and error states. Actual Edge, Firefox, Safari, and manual
screen-reader coverage remain gaps; see [`d10-hardening.md`](d10-hardening.md).

D11 runs the same production suite from the exact repository-scoped path and
adds a direct-load/reload assertion for the waiting state. The complete real
five-target workflow now inspects the downloaded encounter-log content,
the separately loaded worker URL, unchanged page URL, empty browser storage,
cookies and service-worker registrations, and same-origin bodyless requests.
After deployment, that direct-load and full workflow pair runs against the URL
returned by GitHub in Chromium, Firefox, and WebKit proxies. These labels do not
claim actual Edge, installed Firefox, or installed Safari coverage.
