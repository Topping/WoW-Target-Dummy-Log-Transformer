# Worker and pass-one discovery

This document records the concrete D04-D05 behavior. It supplements the product
rules and decisions in `spec.md` and `docs/delivery-plan.md`.

## Browser transport and operation lifecycle

`src/worker` is the only processing layer that accepts browser `File`/`Blob`
objects. A discovery operation performs these phases:

1. `opening-file` at zero processed bytes;
2. `validating-file` while reading at most 64 KiB from the beginning;
3. `scanning-actors` while streaming the complete Blob through the D02 decoder;
4. `detecting-attempts` after the final source byte has been consumed.

Progress is byte-based and monotonic within each phase. Scanning reports the
actual bytes yielded by `Blob.stream()` and completes at the file's real size.
No worker path calls `File.text()` or splits a whole-file string.
If the stream ends at a byte count different from `Blob.size`, processing stops
with `INCOMPLETE_BLOB_READ` rather than reporting fabricated completion.

The initial sample must contain complete combat-log syntax and a valid
`COMBAT_LOG_VERSION`; filenames and MIME types are not trusted. Source failures
map as follows:

| Condition                                        | Category                 | Representative code                                 |
| ------------------------------------------------ | ------------------------ | --------------------------------------------------- |
| empty Blob                                       | `empty-file`             | `EMPTY_FILE`                                        |
| sample/stream read failure                       | `file-unreadable`        | `FILE_SAMPLE_UNREADABLE` / `BYTE_STREAM_FAILED`     |
| prose, missing version, malformed initial record | `invalid-combat-log`     | `UNRELATED_FILE_CONTENT` / `INVALID_INITIAL_SAMPLE` |
| invalid UTF-8 or unsupported project/schema      | `unsupported-log-format` | `INVALID_UTF8` / `NO_COMPATIBLE_SCHEMA`             |
| no player GUID/type                              | `no-player-characters`   | `NO_PLAYER_CHARACTERS`                              |
| explicit cancellation                            | `cancelled`              | `OPERATION_CANCELLED`                               |

The worker runtime has one active operation token. `CANCEL` invalidates it;
starting a replacement invalidates the previous token. Every progress and
terminal response checks that token immediately before publication. The
main-thread `ParserWorkerClient` independently filters response operation IDs,
settles superseded promises as cancelled, and can start a new operation on the
same worker. These two guards cover both cooperative cancellation races and
already-queued stale messages.

`PROCESS_SESSION` uses the same lifecycle and delegates to a typed processor.
The browser worker now installs D06's real second-pass adapter. The adapter owns
the `File` and Blob stream, passes only byte chunks, plain file metadata, the
selection, and options into core extraction, and reports reading, filtering,
and result-building phases. The injectable runtime fallback remains the
recoverable `SESSION_PROCESSOR_NOT_INSTALLED` error for tests or alternate
runtimes that deliberately omit a processor.

Session extraction checks the same active operation token while reading and
while filtering. Cancelling or superseding an extraction suppresses its late
progress and completion, and the same worker can immediately process a new
selection. Early completion of the selected post-roll cancels the remaining
Blob reader without treating the intentional partial source read as an error.

The concrete D06 filtering and D07 export behavior is documented in
[`extraction-and-exports.md`](extraction-and-exports.md).

`DISCOVER_FILE.options` optionally carries `SessionDiscoveryOptions`; omission
uses the exported defaults. This keeps the normal path zero-configuration while
allowing tests, developer tooling, and a later advanced UI to override the
threshold without changing sessionization code.

## Discovery aggregation

Pass one keeps one aggregate per observed actor/target/owned entity, encounter
envelopes, and current/completed candidate windows. It does not retain raw lines
or `CombatEvent` objects. `DiscoveryResult.retainedState` exposes those counts
and fixes both retained-event and retained-line counts at zero for regression
tests.

Every player GUID/type remains selectable. Activity rank combines outgoing
casts, outgoing damage, activity duration, action consistency, and distinct
target interactions. A player is marked as a recorder candidate only when its
flags include `COMBATLOG_OBJECT_AFFILIATION_MINE`; `proposedRecorderGuid` is set
only when exactly one such player exists.

Target rank combines interaction count, sustained duration, interacting-player
evidence, and non-player GUID type. Names are descriptive only; no English
“Training Dummy” substring participates in qualification or scoring.

Summon/create edges record lightweight owned-entity observations. When exactly
one recorder candidate exists, a non-player mine flag is also retained as a
discovery ownership signal. This is not D06 ownership conflict resolution.

## Sessionization and confidence

Candidate grouping is per player across all affected targets, so cleave remains
one window with a non-empty target set. The default options are:

| Option                                | Default |
| ------------------------------------- | ------: |
| `inactivityThresholdMs`               |  10,000 |
| `likelyMinimumDurationMs`             |  20,000 |
| `likelyMinimumPlayerInitiatedActions` |       2 |
| `likelyMinimumQualifyingActions`      |       3 |
| `includeIncidental`                   | `false` |

Direct spell/swing/range damage or misses, target-directed successful/started
casts, and directly applied hostile debuffs establish player intent. Periodic
damage and observed owned-entity damage may extend a current group but cannot
create a normal group. Self-buffs, heals, resource records, failed casts,
unrelated incoming effects, and nearby-player activity do not move the
inactivity clock. Duplicate `SWING_DAMAGE_LANDED`, aura refresh/removal/dose
records, and similar secondary records do not independently qualify.

Schema encounter boundaries discard pre-pull/current candidate activity from
normal training results and retain the explicit encounter envelope. Zone/map/log
boundaries, affected-target death/destruction, and backwards timestamps split
windows. The current schema has no generic combat-start/end record, so remaining
groups use the configured qualifying-action gap.

“Likely” requires all configured duration, player-intent-count, and sustained
activity thresholds. Any explicit player intent produces at least “Possible.”
Passive/periodic/owned-only windows are “Incidental” and are returned only when
`includeIncidental` is enabled. Typed reason codes explain each tier; target
count never lowers confidence.

The approved 10-second fixtures produce four session-splitting groups and one
87.413-second five-target cleave group. In the noisy single-target capture, the
approved direct-player window is contained exactly at its start and through its
approved end; the discovery group continues briefly while the recorder's
explicitly summoned Risen Ghoul keeps attacking, as required by the owned-entity
extension rule.
