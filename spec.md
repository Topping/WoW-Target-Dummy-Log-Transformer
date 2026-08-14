# WoW Training Dummy Log Analyzer

**Status:** Draft v0.2  
**Target:** World of Warcraft Retail  
**Primary platform:** Static browser application  
**Hosting target:** GitHub Pages  
**Primary input:** `WoWCombatLog.txt` with Advanced Combat Logging enabled  
**Primary processing model:** Entirely client-side  
**Initial use case:** Single-player, single-target training dummy sessions

---

# 1. Product goal

Build a simple web application that allows a World of Warcraft player to:

1. Open a website.
2. Drag in their `WoWCombatLog.txt`.
3. Select their character.
4. Select a detected training-dummy attempt.
5. Produce a clean representation of that attempt.
6. Inspect basic information about the session.
7. Export the filtered or normalized data.

All combat-log processing should happen **inside the user's browser**.

The raw combat log must not be uploaded to a server.

The intended user experience is:

```text
Open website
    ↓
Drop WoWCombatLog.txt
    ↓
Choose character
    ↓
Choose training session
    ↓
Process session
    ↓
Review / export result
```

The user should not need:

- a terminal,
- Python,
- Node.js,
- an installed application,
- an account,
- a server,
- or technical knowledge of WoW combat-log internals.

---

# 2. Longer-term product direction

The parser/transposer is infrastructure for a future rotation-analysis product.

The eventual experience should resemble:

```text
Frost Death Knight
5:02 Training Dummy

Rotation analysis

⚠ Killing Machine expired unused 4 times
⚠ Pillar of Frost delayed by 8.4 seconds total
⚠ 46 Runic Power overcapped
⚠ 3 low-priority Frost Strike casts

Timeline
────────────────────────────────────
0:32   Killing Machine expired
1:14   Incorrect priority
2:07   Resource overcap
...
```

However, **rotation analysis is not part of v0.2**.

The initial milestone is reliable extraction of a clean training session from a noisy combat log.

---

# 3. Core design principle

The application should be:

> Browser-first, privacy-preserving, installation-free, and usable by non-technical players.

The parser should remain independent from the UI so that future tools can reuse it.

Conceptually:

```text
Web UI
  ↓
Worker API
  ↓
Parser Core
  ↓
Normalized Session
```

The parser core must not depend on React, Vue, Svelte, DOM APIs, or visual components.

---

# 4. Privacy model

The user's combat log should remain on their device.

The application must not upload:

- combat-log contents,
- character names,
- character GUIDs,
- session data,
- combat events,
- exported files.

The UI should communicate this clearly.

Suggested text:

> **Your combat log stays on your computer.**  
> This file is processed locally in your browser and is never uploaded.

No backend is required for v0.2.

---

# 5. Hosting model

The production application should be deployable as a static site.

Primary target:

```text
GitHub Pages
```

The application should consist entirely of static assets:

```text
index.html
JavaScript
CSS
fonts/icons if required
```

No runtime server should be necessary.

Deployment should be possible through GitHub Actions.

---

# 6. Recommended technology stack

Suggested baseline:

```text
TypeScript
Vite
Web Workers
Vitest
```

UI framework is optional.

Suitable choices include:

```text
React
Vue
Svelte
Solid
plain TypeScript
```

The parser architecture must remain framework-independent.

For a small application, Svelte or React are both reasonable, but this specification does not require either.

---

# 7. Repository structure

Suggested layout:

```text
wow-dummy-analyzer/
│
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── src/
│   │
│   ├── core/
│   │   ├── parser/
│   │   │   ├── lineReader.ts
│   │   │   ├── timestamp.ts
│   │   │   ├── csv.ts
│   │   │   ├── eventSchemas.ts
│   │   │   └── parser.ts
│   │   │
│   │   ├── actors/
│   │   │   ├── actorResolver.ts
│   │   │   └── ownership.ts
│   │   │
│   │   ├── discovery/
│   │   │   ├── playerDiscovery.ts
│   │   │   ├── targetDiscovery.ts
│   │   │   └── sessionDiscovery.ts
│   │   │
│   │   ├── filtering/
│   │   │   └── eventFilter.ts
│   │   │
│   │   ├── models/
│   │   │   ├── Actor.ts
│   │   │   ├── CombatEvent.ts
│   │   │   ├── Session.ts
│   │   │   └── DiscoveryResult.ts
│   │   │
│   │   └── exporters/
│   │       ├── jsonExporter.ts
│   │       ├── rawLogExporter.ts
│   │       └── encounterExporter.ts
│   │
│   ├── worker/
│   │   ├── parser.worker.ts
│   │   └── workerProtocol.ts
│   │
│   ├── ui/
│   │   ├── FileDrop.*
│   │   ├── PlayerSelect.*
│   │   ├── SessionSelect.*
│   │   ├── ProcessingProgress.*
│   │   ├── SessionSummary.*
│   │   └── ExportPanel.*
│   │
│   └── main.ts
│
├── tests/
│   ├── fixtures/
│   ├── parser.test.ts
│   ├── discovery.test.ts
│   ├── filtering.test.ts
│   └── roundTrip.test.ts
│
└── docs/
    ├── architecture.md
    ├── retail-log-format.md
    └── test-data.md
```

---

# 8. Application states

The UI should operate as a small state machine.

## State 1 — waiting for file

```text
┌────────────────────────────────────┐
│                                    │
│   Drop WoWCombatLog.txt here       │
│                                    │
│      or choose a file              │
│                                    │
│   Processed locally in browser     │
│                                    │
└────────────────────────────────────┘
```

Accepted file:

```text
WoWCombatLog.txt
```

Other `.txt` or `.log` files may be allowed, but the application should warn if the format is not recognized.

---

## State 2 — scanning

The application performs a lightweight first pass.

Example:

```text
Scanning combat log...

████████████████░░░░░░  68%

347 MB processed

Finding:
• characters
• targets
• training attempts
```

The UI must remain responsive.

The file scan must therefore run in a Web Worker.

---

## State 3 — character selection

If one likely player is found:

```text
Character detected

Pølsefatter-ArgentDawn-EU

[Continue]
```

If multiple players appear:

```text
Which character do you want to analyze?

○ Pølsefatter-ArgentDawn-EU
○ Examplemage-ArgentDawn-EU
○ Examplewarrior-Silvermoon-EU
```

Do not expose GUIDs unless advanced/debug mode is enabled.

---

## State 4 — target/session selection

Display detected candidate attempts.

Example:

```text
Training sessions

● 11:47:30 → 11:52:32
  5m 02s
  Training Dummy
  184.3M damage

○ 11:31:20 → 11:34:22
  3m 02s
  Training Dummy
  103.7M damage

○ 12:04:11 → 12:05:13
  1m 02s
  Training Dummy
  31.2M damage
```

Where possible, the user should select a **session**, not independently configure a target GUID and time range.

Advanced overrides may be available later.

---

## State 5 — detailed processing

Once the user selects a session, perform the second pass.

Example:

```text
Processing selected attempt...

Reading relevant events
Resolving pets and summons
Filtering nearby players
Building session timeline
```

---

## State 6 — result

Initial v0.2 result:

```text
Pølsefatter-ArgentDawn-EU

Training Dummy
11:47:30 → 11:52:32
Duration: 5m 02s

Relevant combat events: 8,421
Unrelated events removed: 120,489
Pets / guardians detected: 3
External buffs detected: 1
Unknown event types: 0

[Export JSON]
[Export filtered combat log]
```

Synthetic encounter export should initially live behind:

```text
Advanced / Experimental
```

---

# 9. Large-file strategy

Combat logs can become very large.

The application must not require:

```typescript
const wholeFile = await file.text();
```

followed by:

```typescript
wholeFile.split("\n");
```

for normal operation.

Instead, process the input incrementally.

Conceptually:

```text
File
 ↓
ReadableStream
 ↓
TextDecoder
 ↓
Line splitter
 ↓
Parser / scanner
```

Memory usage should scale primarily with:

```text
selected session size
```

rather than:

```text
entire log size
```

---

# 10. Two-pass architecture

The browser implementation should use two logical passes.

---

# 11. Pass 1 — discovery scan

Purpose:

> Determine what is in the file without retaining the entire combat log.

Pass 1 should gather only lightweight metadata.

It should discover:

- player GUIDs,
- player names,
- likely primary players,
- creature GUIDs,
- probable target dummies,
- player-to-target interactions,
- candidate session boundaries,
- basic event counts,
- summons/controlled entities where practical,
- timestamps,
- relevant damage totals.

Do not retain every parsed combat event.

---

# 12. Discovery data model

Example:

```json
{
  "file": {
    "name": "WoWCombatLog.txt",
    "size": 538291004
  },

  "players": [
    {
      "guid": "Player-3702-0A70D8DF",
      "name": "Pølsefatter-ArgentDawn-EU",
      "activityScore": 0.94
    }
  ],

  "targets": [
    {
      "guid": "Creature-...",
      "name": "Training Dummy",
      "damageFromPlayer": 184321443
    }
  ],

  "sessions": [
    {
      "id": "session-1",
      "playerGuid": "Player-3702-0A70D8DF",
      "targetGuid": "Creature-...",
      "startTime": "...",
      "endTime": "...",
      "durationMs": 302201
    }
  ]
}
```

This object should remain small even if the source log is several gigabytes.

---

# 13. Pass 2 — detailed extraction

After the user selects a session:

1. Reread the original `File`.
2. Skip records before the selected time window.
3. Parse records within or immediately around that window.
4. Resolve relevant actors.
5. Filter unrelated activity.
6. Build the canonical session representation.

The browser retains the original `File` object between the two passes.

The user should not need to select the file again.

---

# 14. Optional pre-roll and post-roll

Some events immediately before the first offensive action may matter.

Examples:

- buffs applied before attacking,
- summons,
- cooldown activation,
- resource changes.

Therefore detailed extraction should optionally inspect:

```text
session start - N seconds
```

and:

```text
session end + N seconds
```

Suggested initial value:

```text
5 seconds
```

These records can be used for state reconstruction without necessarily extending the visible session duration.

---

# 15. Web Worker architecture

Parsing should execute outside the main browser thread.

Suggested relationship:

```text
Main thread
    │
    │ postMessage()
    ▼
Parser Worker
    │
    ├── stream file
    ├── parse lines
    ├── detect players
    ├── detect sessions
    └── filter events
    │
    ▼
progress/results
    │
    │ postMessage()
    ▼
Main thread
```

The worker protocol should use typed messages.

Example:

```typescript
type WorkerRequest =
  | {
      type: "DISCOVER_FILE";
      file: File;
    }
  | {
      type: "PROCESS_SESSION";
      file: File;
      session: SessionSelection;
    }
  | {
      type: "CANCEL";
    };
```

Responses:

```typescript
type WorkerResponse =
  | {
      type: "PROGRESS";
      phase: string;
      bytesProcessed: number;
      totalBytes: number;
    }
  | {
      type: "DISCOVERY_COMPLETE";
      result: DiscoveryResult;
    }
  | {
      type: "SESSION_COMPLETE";
      session: Session;
    }
  | {
      type: "ERROR";
      error: AppError;
    };
```

---

# 16. Cancellation

The user should be able to stop a long operation.

UI:

```text
Scanning...
58%

[Cancel]
```

Cancellation should terminate or reset the worker cleanly.

The application should remain usable afterward.

---

# 17. Progress reporting

Because logs may be large, operations should report progress based primarily on:

```text
bytes processed / file size
```

Do not report fake progress percentages based on guessed durations.

Possible phases:

```text
Opening file
Scanning actors
Detecting attempts
Processing selected session
Filtering events
Building export
```

---

# 18. Raw line parsing

Each record contains:

```text
timestamp + event payload
```

Example:

```text
8/14/2026 11:47:38.2112  SPELL_CAST_SUCCESS,...
```

The parser must preserve the original timestamp precision.

Store:

```typescript
interface ParsedTimestamp {
  raw: string;
  epochMs?: number;
  fractionalComponent?: string;
}
```

Do not silently truncate fractional timestamp data.

---

# 19. CSV handling

Do not use:

```typescript
payload.split(",");
```

The parser must correctly handle:

- quoted strings,
- Unicode character names,
- empty fields,
- `nil`,
- hexadecimal values,
- commas contained within quoted fields if present.

The following must survive correctly:

```text
"Pølsefatter-ArgentDawn-EU"
```

---

# 20. Event representation

The canonical event representation should preserve both normalized and original data.

Example:

```typescript
interface CombatEvent {
  timestamp: ParsedTimestamp;
  relativeMs: number;

  type: string;

  source?: ActorReference;
  destination?: ActorReference;

  spell?: {
    id?: number;
    name?: string;
    school?: string;
  };

  payload: unknown;
  additionalFields: string[];

  origin: "combat-log" | "synthetic";

  raw: string;
}
```

Unknown data must not be discarded.

---

# 21. Common source/destination header

Many combat-log events share the structure:

```text
sourceGUID
sourceName
sourceFlags
sourceRaidFlags

destinationGUID
destinationName
destinationFlags
destinationRaidFlags
```

The parser should normalize these fields where applicable.

Not every event follows the same schema.

Event-specific parsers remain necessary.

---

# 22. Event schema system

Initial support should prioritize:

```text
SPELL_CAST_START
SPELL_CAST_SUCCESS
SPELL_CAST_FAILED

SPELL_DAMAGE
SPELL_PERIODIC_DAMAGE
SWING_DAMAGE
RANGE_DAMAGE

SPELL_AURA_APPLIED
SPELL_AURA_REFRESH
SPELL_AURA_REMOVED
SPELL_AURA_APPLIED_DOSE
SPELL_AURA_REMOVED_DOSE

SPELL_ENERGIZE
SPELL_PERIODIC_ENERGIZE
SPELL_DRAIN

SPELL_SUMMON
SPELL_CREATE

UNIT_DIED
UNIT_DESTROYED

COMBATANT_INFO

ENCOUNTER_START
ENCOUNTER_END
```

Unknown events must remain parseable as generic records.

Example:

```typescript
{
  type: "UNKNOWN_EVENT",
  rawEventName: "...",
  fields: [...]
}
```

Unknown events must not crash file processing.

---

# 23. Schema evolution

The WoW combat-log format can change between patches.

Avoid deeply coupling parsing logic to one observed line format.

Store parser schema/version information.

Example:

```typescript
interface ParserMetadata {
  parserVersion: "0.2.0";
  schemaProfile: "retail-2026-08";
}
```

Development fixtures should be retained when future game patches alter the format.

---

# 24. Actor model

Every GUID encountered should be modeled as an actor.

```typescript
interface Actor {
  guid: string;
  name?: string;

  type:
    | "player"
    | "creature"
    | "pet"
    | "guardian"
    | "vehicle"
    | "unknown";

  relationship:
    | "primary"
    | "owned-by-primary"
    | "target"
    | "external"
    | "unknown";

  ownerGuid?: string;
}
```

---

# 25. Primary-player discovery

The UI should avoid requiring users to know GUIDs.

Pass 1 should rank probable player characters based on:

- outgoing spell casts,
- outgoing damage,
- length of activity,
- consistency across the log,
- number of target interactions.

If one character is overwhelmingly likely, it may be preselected.

The user should still be able to choose another detected character.

---

# 26. Target discovery

Likely targets should be ranked using evidence such as:

- sustained damage received from the selected player,
- number of offensive spells directed at the target,
- interaction duration,
- creature/NPC GUID type,
- repeated sessions involving the same target.

Do not rely solely on the NPC name being:

```text
Training Dummy
```

Different dummy types, localizations, or future game changes may use different names.

---

# 27. Candidate-session detection

For each relevant player-target pair, identify active combat windows.

A candidate session begins at the earliest clearly relevant intentional action.

Possible signals:

```text
SPELL_CAST_START
SPELL_CAST_SUCCESS
damage
debuff application
other offensive interaction
```

---

# 28. Session termination

Initial default:

```text
10 seconds of relevant inactivity
```

Example:

```text
attack
attack
attack
stop for 27 sec
attack
attack
```

should produce:

```text
Session 1
Session 2
```

The inactivity threshold should eventually be adjustable under advanced settings.

The normal UI should not require users to configure it.

---

# 29. Session scoring

Candidate sessions should receive a confidence score.

Useful signals:

- session length,
- sustained player-to-target activity,
- damage volume,
- lack of encounter metadata,
- repeated interaction with one stationary target,
- target creature type.

The UI may label uncertain detections:

```text
Likely training attempt
Possible training attempt
```

Do not imply certainty when detection is ambiguous.

---

# 30. Manual override

Automatic detection will not always succeed.

Advanced UI should eventually allow:

```text
Character
Target
Start time
End time
```

to be chosen manually.

This should be hidden behind:

```text
Advanced
```

for normal users.

---

# 31. Controlled entities

Player-owned pets, guardians, summons, and temporary entities must be treated as part of the player's session where possible.

Ownership graph:

```text
Player
 ├── Pet
 ├── Guardian
 ├── Temporary summon
 └── Other controlled entity
```

Useful signals may include:

```text
SPELL_SUMMON
ownership-related GUID relationships
creation events
player abilities known to summon entities
```

Filtering must not discard pet damage simply because:

```text
sourceGUID != playerGUID
```

---

# 32. External effects

Effects cast by unrelated players onto the selected player may affect the attempt.

Example:

```text
OtherPlayer
   ↓
Power Infusion
   ↓
Selected Player
```

Such events must be retained and classified.

Example:

```typescript
{
  externalEffect: true
}
```

A later rotation analyzer can choose whether to normalize or account for these effects.

The parser should preserve reality rather than silently removing them.

---

# 33. Event filtering

Define:

```text
P = selected player
O = entities owned by P
T = selected target
```

Baseline relevant-event rule:

```text
source ∈ {P, O}

OR

destination ∈ {P, O}

OR

source ∈ {P, O} AND destination == T

OR

source == T AND destination ∈ {P, O}
```

Additionally preserve metadata required to interpret relevant events.

---

# 34. Filtering audit data

The detailed result should track why records were removed or retained.

Example counts:

```json
{
  "kept": {
    "primaryPlayer": 4921,
    "ownedEntities": 2044,
    "selectedTarget": 1300,
    "externalEffects": 156
  },

  "removed": {
    "unrelatedPlayers": 108230,
    "unrelatedCreatures": 12259
  }
}
```

This data is especially useful during development.

---

# 35. Debug mode

A developer/debug setting should expose individual filtering decisions.

Example:

```text
KEEP 11:47:38.211 SPELL_CAST_SUCCESS
source = primary player

KEEP 11:47:38.344 SPELL_DAMAGE
destination = selected target

DROP 11:47:38.411 SPELL_CAST_SUCCESS
source = unrelated player
destination = unrelated creature
```

This does not need to be prominent in the normal UI.

---

# 36. Canonical session model

The primary output of the parser should be a normalized in-memory `Session`.

Example:

```typescript
interface Session {
  metadata: {
    startTime: string;
    endTime: string;
    durationMs: number;
  };

  player: Actor;
  target: Actor;

  actors: Actor[];

  events: CombatEvent[];

  warnings: SessionWarning[];

  statistics: SessionStatistics;
}
```

This—not a rewritten WoW log—should be the canonical representation.

---

# 37. JSON export

Users should be able to export:

```text
session.json
```

Example:

```json
{
  "parser": {
    "version": "0.2.0",
    "schema": "retail-2026-08"
  },

  "session": {
    "durationMs": 302201
  },

  "player": {
    "guid": "Player-3702-0A70D8DF",
    "name": "Pølsefatter-ArgentDawn-EU"
  },

  "target": {
    "guid": "Creature-..."
  },

  "actors": [],
  "events": []
}
```

This format should later serve as the input to rotation analysis.

---

# 38. Filtered raw-log export

Users should also be able to export:

```text
session.filtered.log
```

This should preserve relevant original lines in original chronological order.

Where possible, retained raw lines should remain unchanged.

---

# 39. Client-side download generation

Exports should be generated entirely in-browser.

Conceptually:

```text
Session
  ↓
serialize
  ↓
Blob
  ↓
browser download
```

No exported file needs to pass through a backend.

---

# 40. Synthetic encounter export

A future or experimental export may generate:

```text
session.encounter.log
```

containing explicit encounter-like boundaries.

This feature should initially be hidden behind:

```text
Advanced
→ Experimental encounter export
```

The application must clearly label generated records as synthetic internally.

---

# 41. Encounter-envelope research

Before implementing synthetic encounters, compare:

```text
dummy log
```

against:

```text
genuine boss encounter
```

recorded from the same current Retail client.

Research questions:

- What exactly surrounds `ENCOUNTER_START`?
- What fields are currently present?
- When is `COMBATANT_INFO` emitted?
- What happens immediately after encounter start?
- What metadata appears before encounter end?
- Which records exist only during genuine encounters?

Document findings in:

```text
docs/retail-log-format.md
```

---

# 42. Synthetic encounter constraints

Do not fabricate an existing boss kill.

In particular, the program should not intentionally assign an existing raid encounter ID merely to fool Warcraft Logs into accepting the session as that boss.

The purpose of synthetic output is:

> experiment with encounter-shaped logs

not:

> create fake public parses.

Warcraft Logs compatibility is not required for the parser to be considered successful.

---

# 43. COMBATANT_INFO

If `COMBATANT_INFO` exists naturally in the selected source data, retain it.

If it does not:

```text
do not fabricate it in v0.2
```

A future feature may allow metadata to be imported from a genuine encounter recorded with the same character and build.

---

# 44. User-facing error handling

Errors must be understandable to normal players.

Avoid:

```text
ParserException:
Expected field 29 but got field 31
```

Prefer:

```text
This combat log contains a format we don't recognize yet.

The file was created successfully by WoW, but this version of the analyzer
doesn't understand one of its event formats.

[Show technical details]
```

---

# 45. Error categories

## User-recoverable

Examples:

```text
No WoW combat events found
No player characters detected
No training sessions detected
Selected file appears empty
```

Provide suggested actions.

---

## Parser warning

Examples:

```text
Unknown event type encountered
Unexpected field count
Missing actor name
Missing target metadata
External player buff detected
```

Processing should continue where safe.

---

## Fatal parser failure

Examples:

```text
Timestamp structure cannot be identified
File cannot be decoded
Internal parser invariant broken
```

Offer technical details suitable for attaching to a bug report.

---

# 46. No-session UX

If no training session is detected:

```text
We couldn't automatically find a training-dummy attempt.

Try:

• Make sure /combatlog was enabled.
• Fight one dummy continuously for at least 20–30 seconds.
• Avoid switching between several dummies during the test.

[Advanced: choose time range manually]
```

---

# 47. File validation

On file selection:

1. Verify file is readable.
2. Inspect a small initial sample.
3. Confirm the contents resemble WoW combat-log syntax.
4. Begin streaming only after validation.

Do not reject solely based on filename.

---

# 48. Browser compatibility

Initial support target:

```text
Current Chrome
Current Edge
Current Firefox
Current Safari
```

Where an API differs across browsers, prefer broadly supported primitives.

Avoid requiring experimental file-system APIs.

Basic `<input type="file">` and drag-and-drop should remain sufficient.

---

# 49. Mobile support

The application may be responsive, but processing large WoW combat logs on phones is not a primary v0.2 requirement.

Desktop browsers are the primary target.

Mobile UI should fail gracefully rather than being intentionally unsupported.

---

# 50. Performance goals

These are initial engineering targets rather than strict guarantees.

The UI should:

- remain responsive during parsing,
- avoid loading the entire source file as one string,
- avoid retaining irrelevant events,
- provide visible progress,
- permit cancellation.

Memory consumption should depend primarily on the selected attempt rather than total file size.

---

# 51. Browser-memory protection

The worker should monitor approximate retained data volume where practical.

If a selected session produces an unreasonable number of events, the application may warn:

```text
This session is unusually large.

It may contain multiple targets or overlapping combat.
```

Avoid crashing the entire page where possible.

---

# 52. First-pass performance strategy

Pass 1 should avoid constructing full `CombatEvent` objects for every line.

Instead use a lightweight scanner capable of extracting only:

```text
timestamp
event type
source GUID
source name
destination GUID
destination name
basic spell/damage information
```

as required for discovery.

Full event parsing happens only during pass 2.

---

# 53. Early timestamp skipping

During pass 2, after the relevant timestamp range is known:

```text
before session pre-roll
    → skip quickly

inside relevant window
    → fully parse

after session post-roll
    → stop processing
```

This avoids processing the rest of a multi-hour log unnecessarily.

---

# 54. Testing strategy

The core parser must be testable outside the browser UI.

Unit tests should operate directly against fixtures.

The worker and UI should be comparatively thin layers around tested core logic.

---

# 55. Test fixtures

Suggested:

```text
tests/fixtures/

01_single_player_single_dummy.log
02_multiple_players_dummy_area.log
03_player_with_pet.log
04_player_with_guardians.log
05_external_buff.log
06_two_sessions.log
07_unknown_event.log
08_unicode_character_name.log
09_real_encounter.log
10_dummy_and_real_encounter_same_build.log
11_large-noisy-sample.log
```

Every newly discovered parser bug should ideally become a permanent regression fixture.

---

# 56. Required real-world captures

Initial development data should include:

## Capture A — minimal dummy

```text
30–60 seconds
one character
one dummy
as few nearby players as possible
```

---

## Capture B — real dummy environment

```text
approximately 5 minutes
normal rotation
busy training area acceptable
normal cooldown usage
```

---

## Capture C — session splitting

```text
1 minute attack
30 seconds idle
1 minute attack
```

Expected:

```text
two sessions
```

---

## Capture D — genuine encounter

Same character and preferably same build.

A trivial old boss is sufficient.

Purpose:

```text
inspect encounter metadata
```

---

## Capture E — pets/summons

Use every relevant pet, guardian, temporary summon, or similar mechanic available to the test specialization.

---

# 57. Round-trip testing

For supported raw records:

```text
raw line
  ↓
parse
  ↓
serialize
  ↓
semantically equivalent line
```

Test:

- quoted text,
- `nil`,
- zero GUIDs,
- hexadecimal values,
- Unicode,
- advanced logging fields.

---

# 58. Worker integration testing

Test:

```text
DISCOVER_FILE
```

returns:

```text
players
targets
sessions
```

and:

```text
PROCESS_SESSION
```

returns a valid normalized `Session`.

Also test:

```text
CANCEL
```

during an active scan.

---

# 59. UI acceptance tests

At minimum:

### Happy path

```text
drop valid log
→ select player
→ select session
→ process
→ export
```

### Multiple players

```text
drop valid log
→ several players detected
→ choose correct player
→ sessions update accordingly
```

### No sessions

```text
drop valid log
→ player found
→ no clear dummy attempt
→ helpful recovery UI
```

### Invalid file

```text
drop unrelated text file
→ clear error
→ user can choose another file
```

---

# 60. Accessibility

Basic requirements:

- file selection usable without drag-and-drop,
- keyboard-accessible controls,
- semantic buttons/forms,
- progress communicated in text as well as visually,
- do not rely solely on color to communicate warnings/errors.

---

# 61. Initial visual scope

v0.2 does not require complex dashboards.

A clean single-page workflow is preferable.

Suggested screens/components:

```text
FileDrop
↓
ScanProgress
↓
PlayerSelect
↓
SessionSelect
↓
ProcessProgress
↓
SessionSummary
↓
ExportPanel
```

Avoid premature complexity.

---

# 62. URL behavior

No combat data should be encoded into the URL.

Refreshing the page may reset the application.

Persisting logs between sessions is not required.

---

# 63. Local storage

Do not store the combat-log contents in:

```text
localStorage
IndexedDB
cookies
```

for v0.2.

Small non-sensitive preferences may eventually be stored, such as:

```text
advanced settings expanded
preferred inactivity threshold
```

but are not necessary initially.

---

# 64. Analytics

Do not add analytics in v0.2.

This keeps the privacy claim simple:

> the application has no reason to transmit anything about the user's log or character.

If analytics are introduced later, they must remain completely separate from combat-log content.

---

# 65. Network independence

Core parsing must not depend on network access after the page loads.

Future features may optionally fetch:

- game data,
- spell metadata,
- SimulationCraft data,
- spec definitions.

Those features must remain separable from the parser.

---

# 66. Future offline/PWA support

A service worker may later cache application assets.

This would allow:

```text
load application once
↓
open it later without internet
↓
process combat logs locally
```

This is desirable but not required for v0.2.

---

# 67. Development-only tooling

A CLI may still be useful **for developers**, but should not be considered the product.

Potential developer command:

```text
npm run inspect -- path/to/WoWCombatLog.txt
```

could help:

- generate fixtures,
- inspect schemas,
- compare encounter envelopes,
- debug parsing.

The public user experience remains browser-only.

---

# 68. Development inspector

An optional developer page may expose:

```text
Detected actors
Detected GUIDs
Event type counts
Unknown event types
Field counts
Session boundaries
Filtering decisions
```

For example:

```text
?debug=1
```

This should not clutter the normal application.

---

# 69. Encounter comparison tooling

A developer utility should compare dummy and genuine encounter captures.

Output concept:

```text
EVENT TYPE                   DUMMY     BOSS

SPELL_CAST_SUCCESS           yes       yes
SPELL_DAMAGE                 yes       yes
SPELL_AURA_APPLIED           yes       yes
COMBATANT_INFO               no        yes
ENCOUNTER_START              no        yes
ENCOUNTER_END                no        yes
```

Also compare field counts and metadata structure.

---

# 70. Phase 1 — parser foundation

Goal:

> Correctly parse known current Retail events.

Completion criteria:

- timestamp extraction,
- CSV-safe parsing,
- common actor fields,
- spell fields,
- unknown event preservation,
- Unicode correctness,
- round-trip tests.

---

# 71. Phase 2 — streaming browser scanner

Goal:

> Open a large `WoWCombatLog.txt` without blocking the UI or loading it entirely into memory.

Completion criteria:

- `File` accepted,
- streaming reader,
- worker processing,
- progress reporting,
- cancellation.

---

# 72. Phase 3 — discovery

Goal:

> Automatically identify likely characters, targets, and training sessions.

Completion criteria:

- player list,
- target candidates,
- candidate sessions,
- session splitting,
- confidence ranking.

---

# 73. Phase 4 — detailed session extraction

Goal:

> Convert one selected session into a clean normalized `Session`.

Completion criteria:

- second-pass extraction,
- pets/guardians,
- external buffs,
- unrelated-event filtering,
- statistics,
- warnings.

---

# 74. Phase 5 — usable guild-facing UI

Goal:

> Someone with no technical knowledge can use the application without instructions beyond "drop your combat log here."

Completion criteria:

- file-drop interface,
- player selection,
- session selection,
- progress,
- readable summary,
- exports,
- understandable errors.

---

# 75. Phase 6 — GitHub Pages release

Goal:

> Production application is available at a static URL.

Completion criteria:

- production Vite build,
- GitHub Actions deployment,
- GitHub Pages configuration,
- correct asset paths,
- no backend dependency,
- privacy statement visible.

---

# 76. Phase 7 — synthetic encounter research

Goal:

> Determine whether a selected dummy session can be safely represented using encounter-like WoW log metadata.

This remains experimental.

Warcraft Logs compatibility is not required for release.

---

# 77. Phase 8 — rotation-analysis foundation

After extraction is reliable, begin reconstructing game state:

```text
buffs
debuffs
resources
cooldowns
procs
cast history
summons
target state
```

The canonical `Session` model should feed this layer directly.

---

# 78. Future SimulationCraft integration

Potential future architecture:

```text
Normalized Session
       │
       ▼
State Reconstructor
       │
       ▼
Observed Decision Timeline
       │
       ├─────────────┐
       ▼             ▼
Player action     SimC/APL choice
       │             │
       └──────┬──────┘
              ▼
        Decision comparison
              ▼
         Rotation feedback
```

This should not require converting the session back into a Warcraft Logs report.

---

# 79. Potential future analysis

Examples:

```text
proc expired unused
resource overcapped
cooldown delayed
cooldown used too early
incorrect ability priority
important buff downtime
DoT dropped
too many filler casts
missed high-priority casts
pet/summon misuse
```

The parser must therefore preserve enough event information to support these later.

---

# 80. Definition of done for v0.2

- [ ] Application loads from a static website.
- [ ] User can drag in `WoWCombatLog.txt`.
- [ ] Log processing occurs entirely client-side.
- [ ] Main UI remains responsive while parsing.
- [ ] Large files are streamed rather than read as one giant string.
- [ ] User sees meaningful progress.
- [ ] Parsing can be cancelled.
- [ ] Character candidates are detected.
- [ ] Likely dummy targets are detected.
- [ ] Candidate training sessions are detected.
- [ ] Multiple attempts can be separated.
- [ ] User can select an attempt.
- [ ] Selected session is reparsed in detail.
- [ ] Relevant player actions are retained.
- [ ] Relevant incoming effects are retained.
- [ ] Player-controlled entities are retained where detectable.
- [ ] Unrelated nearby combat is removed.
- [ ] External effects on the player are identified.
- [ ] Unknown event types do not crash processing.
- [ ] Unicode names parse correctly.
- [ ] Normalized JSON can be exported.
- [ ] Filtered raw log can be exported.
- [ ] No source combat data is uploaded.
- [ ] Application can be hosted on GitHub Pages.
- [ ] Core parser has automated tests independent of the UI.

---

# 81. Primary technical success criterion

Given a large and noisy Retail `WoWCombatLog.txt`, the browser application can reliably extract:

> exactly one selected player's interaction with one target dummy during one selected training attempt

without retaining unrelated nearby combat and without requiring a backend.

---

# 82. Primary product success criterion

A guildmate who has never used a terminal can be told:

> Turn on combat logging, hit the dummy for five minutes, then drag `WoWCombatLog.txt` onto this website.

Everything after that should be understandable without technical instructions.

---

# 83. v0.2 product statement

> **Drop in your WoW combat log, choose your dummy attempt, and get a clean combat session — entirely in your browser.**

The parser/transposer exists to enable this experience.

The eventual analyzer will build on the exact same client-side architecture.