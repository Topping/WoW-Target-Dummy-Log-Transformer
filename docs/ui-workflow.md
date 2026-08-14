# File-to-export UI workflow

This document records the concrete D08-D09 React behavior. React owns
presentation and application state only. It retains the selected `File` as an
opaque browser handle and delegates both passes to `ParserWorkerClient`; it does
not read, parse, extract, filter, or serialize combat-log content.

## State machine

`src/ui/analyzerMachine.ts` is the pure reducer used by the application and by
transition tests. Its states are:

| State                   | User-visible behavior                                                                                                             | Available exits                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `waiting`               | Prominent local-processing statement, content-based acceptance explanation, drag-and-drop area, and keyboard-operable file button | Choose or drop a file                                                        |
| `discovering`           | Filename/size, worker phase, exact bytes read, derived percentage, native progress element, Cancel, and replacement-file action   | Discovery result, recoverable error, Cancel, or replacement file             |
| `recorder-confirmation` | The one player GUID/type carrying `AFFILIATION_MINE` is named without showing its GUID                                            | Continue or Change character                                                 |
| `character-selection`   | Every deduplicated player is a radio option; no heuristic hides a valid player                                                    | Select one and continue, or replace file                                     |
| `session-selection`     | Sessions for only the selected player, with Likely first, Possible separate, and Incidental inside Advanced                       | Process one session, change character, or replace file                       |
| `processing`            | Exact bytes read and truthful extraction/filtering/result-building phase text                                                     | Result, recoverable error, Cancel, or replacement file                       |
| `result`                | Readable session summary, warnings, progressive technical details, and two local export buttons                                   | Export, choose another session/character/file                                |
| `error`                 | Player-facing category/message/action and optional technical details                                                              | Retry the same operation, return to sessions where possible, or replace file |
| `cancelled`             | Explicit confirmation that no partial/late result will be used                                                                    | Rescan the file or return to session selection                               |

Every discovery and processing action has a UI operation ID. Progress,
completion, and failure actions are accepted only while the matching operation
is active. Selecting a replacement, cancelling, or retrying changes the active
ID before an old promise can settle. This is independent of, and complementary
to, the stale-message guards in `ParserWorkerClient` and the worker runtime.

## Intake, selection, and accessibility

The file input has an accessible name and is activated by a normal button, so it
works without drag-and-drop and with keyboard activation. The drop area is an
additional pointer interaction, not the only intake method. There is no
filename or MIME-type rejection in React; worker validation inspects contents.
The privacy statement remains above the workflow in every state.

Progress always displays phase text plus `bytes processed / total bytes` and a
percentage calculated from those values. State headings receive programmatic
focus after a state change. Forms, fieldsets, radio inputs, buttons, progress,
headings, descriptions, status messages, and alerts use semantic elements, and
warning/error meaning is written in text rather than encoded only by colour.

When discovery has exactly one `proposedRecorderGuid` that still exists in the
player list, the UI shows recorder confirmation. Missing, stale, zero-match, or
multiple-match proposals use explicit character selection. The complete player
list remains available through Change character.

Session cards show all target instances, exact visible start/end text, duration
derived from exact ticks, confidence wording and reasons, and target damage
aggregates when discovery supplies them. Because current D05 damage is
target/file aggregate data rather than session-local data, the label explicitly
says it was observed across the file. GUIDs are not rendered as normal labels.
Likely and Possible sessions are separate groups; Incidental sessions, if an
advanced discovery caller requested them, are inside a closed Advanced detail.
No manual time-range control is present.

If a selected player has no Likely or Possible session, the screen explains how
to produce a clearer attempt and still offers character/file changes. Empty,
unreadable, invalid, unsupported, no-player, oversized, and internal failures
use the worker's typed `AppError` message and suggested action with technical
context behind a detail disclosure.

## Result and export behavior

The result summary contains the selected character; every target and optional
focus target; visible range and exact duration; relevant/removed, external, and
unknown counts; per-target event and observed-damage statistics; controlled
entities and human-readable ownership evidence; complete filtering totals and
reason breakdowns; and discovery/extraction warnings. The normal summary uses
names. Actor/target GUIDs, parser/schema metadata, warning context, and optional
filtering debug decisions are confined to the closed Technical and debug details
section.

Both buttons call the existing core serializers through
`createSessionDownload`. The browser-only `saveSessionDownload` helper creates
an object URL, triggers the deterministic filename through a temporary anchor,
removes that anchor, and revokes the URL in a `finally` block. Soft serializer
warnings remain visible after the download. A hard serializer failure creates
no download and is displayed as a recoverable alert.

## Verification boundary

Pure reducer tests cover valid transitions, invalid/stale actions, cancellation,
retry, replacement, export feedback, and reset. jsdom component tests cover
keyboard/drop intake, recorder and explicit character paths, grouping,
multi-target rendering, progress, errors, cancellation, retries, full
file-to-export flow, focus movement, semantic names, and URL revocation. The
repository does not yet configure a real-browser runner; cross-browser and
capture-wide UI smoke testing remains D10 rather than being simulated in unit
tests. Ordinary UI tests use compact synthetic objects and never load
`data/dummy-encounter.txt`.
