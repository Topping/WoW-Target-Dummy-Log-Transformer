# Pass-two extraction, filtering, and exports

This document records the concrete D06-D07 behavior. The public core entry
points are `extractSessionChunks`, `serializeSessionJson`,
`parseSessionJson`, and `serializeFilteredSessionLog`. They import no DOM,
React, File, Blob, storage, or network API.

## Incremental selected-window extraction

`extractSessionChunks` accepts an iterable or async iterable of `Uint8Array`,
plain `InputFileMetadata`, a `SessionSelection`, and optional extraction
settings. The browser adapter in `src/worker/sessionProcessor.ts` is responsible
for turning the original `File` into that byte stream.

The selected start and end are the visible session boundaries. Extraction
defaults to an additional 5,000 ms before and after those boundaries for state
reconstruction. It timestamp-parses lines before the pre-roll without CSV or
event normalization, except that it retains `COMBAT_LOG_VERSION` as required
standalone metadata. It fully tokenizes and normalizes records in the inclusive
pre-roll/post-roll range and stops when it observes the first later timestamp.
Therefore retained events can have negative relative ticks or ticks beyond the
visible duration, while `Session.startTime`, `endTime`, and `durationTicks`
remain unchanged.

Core progress counts bytes actually yielded by the input iterable. The browser
worker reports `processing-session`, `filtering-events`, and `building-result`.
Cancellation is checked per chunk, per decoded record, and during filtering.
No cancelled or superseded operation can publish a session, and an intentionally
early Blob stop is not reported as an incomplete-file failure.

## Actors and ownership

The actor graph observes GUID-derived player, pet, guardian, creature, vehicle,
and unknown types plus exact names and flags. Names are descriptive only.
Ownership claims use this strength order:

1. explicit Advanced Combat Logging actor/owner GUID pairs;
2. `SPELL_SUMMON` or `SPELL_CREATE` edges;
3. `COMBATLOG_OBJECT_AFFILIATION_MINE` on a non-player actor, attributed to the
   selected recording player.

Same-owner evidence is combined. If owners disagree, the stronger claim wins;
equal-strength ties retain the first source observation. Every disagreement
emits typed code `OWNERSHIP_CONFLICT` with the entity GUID and both owner,
evidence, and source-line records. Ownership follows chains, so a summon of an
already-owned actor is controlled by the selected player. The final `Actor`
contains its direct winning owner and the compatible evidence retained for that
edge.

The selected target set is never empty. Each target has independent statistics,
and a focus target is inferred only when the selection contains exactly one
target. Multi-target sessions, including the approved five-target cleave, do not
need a focus target.

## Filtering and audit accounting

After ownership resolution, the core keeps:

- every outgoing record from the selected player or an owned entity;
- every incoming record to the selected player or an owned entity;
- selected-target death/destruction metadata;
- the log-version record, encounter boundaries, and relevant
  `COMBATANT_INFO` records.

An incoming record from an actor outside the player/owned graph is marked
`externalEffect: true`, except when its source is a selected session target.
Unrelated players attacking a selected target, unrelated player-to-creature
activity, same-named but unowned creatures, and other nearby noise are removed.
Generic event types with a recognizable common actor header participate in the
same rules without being falsely marked normalized.

`statistics.filtering.consideredRecordCount` counts the retained version record
plus every fully parsed record in the reconstruction window. It always equals
`keptRecordCount + removedRecordCount`. Kept and removed values are also split
by one primary reason, pre-window timestamp skips are counted separately, and
the audit reports early stopping, bytes read, and retained UTF-8 source bytes.
Optional debug decisions contain the exact timestamp, relative tick, event type,
actor GUIDs, decision, and reason for every considered record.

Per-target statistics report relevant, outgoing, incoming, and outgoing damage
event counts. `observedDamageAmount` is populated only when the schema's stable
damage amount position contains a finite positive number; opaque Advanced tails
are not guessed.

## Extraction budgets

`SessionExtractionBudgets` can independently configure soft and hard retained
event and estimated-byte limits. Estimated retained bytes are the UTF-8 byte
length of each retained raw line plus its exact line terminator.

Soft event/byte crossings emit `SESSION_SOFT_EVENT_LIMIT_EXCEEDED` or
`SESSION_SOFT_BYTE_LIMIT_EXCEEDED` once and continue to a complete Session. Hard
crossings return recoverable `SESSION_HARD_EVENT_LIMIT_EXCEEDED` or
`SESSION_HARD_BYTE_LIMIT_EXCEEDED` errors; no truncated Session is returned.
D10 measured the largest approved window at 5,210 retained events and
1,395,641 retained source bytes. Defaults are now 25,000/50,000 retained events
and 16/32 MiB retained source bytes for soft/hard behavior. They are configurable
desktop safety boundaries, not source-file size limits. Passing an explicit
`budgets` object replaces the default set. Full measurement conditions and
justification are in [`d10-hardening.md`](d10-hardening.md).

## Session JSON v1

`serializeSessionJson` produces a document with:

```json
{
  "format": "wow-training-dummy-session",
  "version": 1,
  "session": {}
}
```

The committed schema is [`session.schema.json`](session.schema.json). It covers
parser/schema metadata, visible boundaries, actors and ownership, events and raw
fields, warnings, target/filtering statistics, and optional debug decisions.
Every `localTimeTicks`, `relativeTimeTicks`, and `durationTicks` value is a
signed base-10 JSON string matching `^-?[0-9]+$`; tick values are never passed
through JSON numbers. `parseSessionJson` accepts only the supported format and
version and restores those strings to exact in-memory `bigint` values.

Serialization is deterministic for the same Session and ends with one LF. Size
limits are optional. A soft crossing emits `EXPORT_SOFT_BYTE_LIMIT_EXCEEDED`
and returns the complete content; a hard crossing returns recoverable
`EXPORT_HARD_BYTE_LIMIT_EXCEEDED` and no content. D10 measured the largest JSON
export at 24,494,536 bytes. Complete exports now default to a 128 MiB soft
warning and 256 MiB hard recoverable failure. Passing an explicit `sizeLimits`
object replaces those defaults. Soft crossings return the complete export with
a warning; hard crossings return no content.

## Filtered raw log and browser downloads

The incremental decoder records `\n`, `\r\n`, or an unterminated final line for
every source record. `serializeFilteredSessionLog` concatenates each retained
event's unchanged `raw` text and exact terminator in source line order. It does
not normalize CSV, timestamps, quoting, Unicode, Advanced fields, or line
endings. The retained version record makes the result independently parseable.

`createSessionDownload` is the browser boundary that creates a Blob and assigns
a filename. Names use a lowercase ASCII-safe player component and compact start
timestamp, for example:

```text
p-lsefatter-argentdawn-eu-20260814-114738.session.json
p-lsefatter-argentdawn-eu-20260814-114738.session.filtered.log
```

The exporters make no network request and use no localStorage, IndexedDB,
cookies, service worker, analytics, or backend.

D09 adds `saveSessionDownload` as the final browser/DOM handoff. It calls
`createSessionDownload`, assigns its Blob to a temporary object URL and hidden
anchor, triggers the deterministic download, then removes the anchor and revokes
the URL in `finally`. A hard serialization limit creates neither an object URL
nor a download. Soft warnings are returned alongside the completed download for
the UI to display.

## D11 deployed-form export validation

The repository-scoped production Playwright workflow downloads both formats
from the emitted static application. It verifies the JSON format/version and
the filtered log's retained `COMBAT_LOG_VERSION` record in addition to their
deterministic filenames. Network observation begins before file intake and
allows only the bodyless same-origin parser-worker request; the download uses
the existing temporary `blob:` URL and does not become a combat-data request.
The same workflow is run against the URL returned after a Pages deployment.
