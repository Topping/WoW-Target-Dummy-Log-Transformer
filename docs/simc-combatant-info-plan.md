# SimulationCraft-backed `COMBATANT_INFO` implementation plan

**Status:** Core/UI and generated production talent data implemented; paired
genuine-event and external-upload validation remain open.

**Researched:** 2026-08-14

## Implementation snapshot

The bounded addon parser, typed profile/equipment contracts, Blizzard bitstream
reader, generated snapshot interface, tiered/granted/choice-node decoder,
schema-bound V22 builder, nested structural validator, encounter-export option,
GUID/schema assertions, distinct provenance warnings, browser download
threading, and ephemeral result-screen form are implemented and covered by
unit/component/export tests.

Production tree data for all 40 playable specializations is generated from
Raidbots' resolved live client data. The generator discovers Wago's non-PTR
`wow` build automatically, pins Raidbots data by content hash, validates node
order/types/entries, and commits a compact artifact; neither maintainers nor
browser users need a WoW installation. This checkout still has no sanitized
`/simc` output paired with a genuine same-character `COMBATANT_INFO` and no
external upload acceptance result for the synthesized record. Synthetic decoder
fixtures exercise protocol mechanics but do not close that validation gap.

## Outcome

Let a user paste the profile produced by the SimulationCraft WoW addon and use
it to build the character-specific `COMBATANT_INFO` record in the generated
encounter log. The selected combat-log player GUID must remain the identity that
joins `COMBATANT_INFO` to the combat events. A validated matching profile is
mandatory; the fixed debugging character must never be used as a fallback.

The pasted profile is **supplemental character information only**. The selected
combat-log session remains the sole source for timestamps, duration, casts,
damage, healing, resources, auras observed during combat, targets, pets and
summons, ownership, filtering, and all other combat events. Importing a profile
must not generate, replace, reorder, reinterpret, or filter combat activity.
Apart from constructing the one synthetic `COMBATANT_INFO` record, encounter
serialization must continue to use the existing extracted session unchanged.

This is not a lossless conversion. A `/simc` profile and a `COMBATANT_INFO`
event overlap, but they are different protocols. The implementation must report
which sections are exact, derived, or defaulted and must never substitute data
from another character.

## What the current app does

The encounter serializer in
[`src/core/exporters/sessionExports.ts`](../src/core/exporters/sessionExports.ts)
does the following:

1. Filters every natural `COMBATANT_INFO` event out of the selected session.
2. Requires a validated, schema-bound `BuiltCombatantInfo` for the selected
   player before exporting.
3. Inserts that payload after the synthetic Razorgore `ENCOUNTER_START`.
4. Fails with `SIMC_PROFILE_REQUIRED` rather than substituting a debugging
   character when profile metadata is unavailable.

The parser currently recognizes `COMBATANT_INFO` and retains its raw fields, but
normalizes only the combatant GUID. It does not parse the nested talent, gear,
or aura structures. That is sufficient for lossless filtering but not for
constructing a new event.

The profile input should remain outside the worker pipeline. It is small text,
does not require access to the combat-log `File`, and is needed only at export
time. Keeping it in core plus UI preserves the current boundary:

```text
combat-log File -> worker -> Session
                              |
/simc text -> core parser -----+-> COMBATANT_INFO builder -> encounter export
```

No runtime network request, browser storage, backend, or change to the existing
two-pass log processing is required.

### Source-of-truth boundary

| Output data                                                      | Authoritative source                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Selected player GUID and display name                            | Combat log `Session`                                         |
| Attempt start/end/duration                                       | Combat log `Session`                                         |
| Casts, damage, healing, resources, and aura events               | Combat log `Session.events`                                  |
| Targets, pets/summons, and ownership                             | Combat log extraction and actor graph                        |
| Encounter envelope and target transposition                      | Existing WowCoach compatibility exporter                     |
| Character class/spec, talent loadout, and equipped gear metadata | Pasted SimulationCraft addon profile                         |
| `COMBATANT_INFO` live values absent from the SimC profile        | Explicit versioned defaults, never inferred as combat events |

The SimC import must not add SimulationCraft actions, APL decisions, simulated
statistics, estimated DPS, or generated events to the output. General SimC
profiles may contain such directives, but this feature accepts only the
official addon's character-export subset and ignores or rejects everything
outside it.

## Research findings

### The SimulationCraft addon output

The official addon's documented interaction is `/simc`; it opens copyable text
intended as SimulationCraft input. The output is a line-oriented profile, not a
single encoded object. The current addon source constructs these relevant
sections:

- provenance comments: `# SimC Addon ...`, `# WoW ...`, and the minimum SimC
  version;
- a class declaration such as `priest="Character"`;
- `level`, `race`, `region`, `server`, `role`, and `spec` options;
- `talents=<Blizzard loadout export string>` for the active loadout;
- one active equipment line per occupied slot, such as
  `head=...,id=...,enchant_id=...,gem_id=...,...`;
- comments containing equipped item names and item levels when the game client
  returns both;
- commented saved loadouts, bag items, weekly rewards, linked gear, and other
  advisory data that are not part of the equipped character.

The addon derives equipment options from WoW item links. The relevant options
include `id`, `enchant_id`, `gem_id`, `bonus_id`, `gem_bonus_id`,
`crafted_stats`, `crafting_quality`, `drop_level`, `content_tuning`, and some
patch-specific options. The stable equipped-slot order is head, neck, shoulder,
back, chest, shirt, tabard, wrist, hands, waist, legs, feet, two fingers, two
trinkets, main hand, off hand, and ammo.

Sources:

- [SimulationCraft addon README](https://github.com/simulationcraft/simc-addon)
- [The addon's profile and item construction](https://github.com/simulationcraft/simc-addon/blob/master/core.lua)
- [The addon's slot and specialization tables](https://github.com/simulationcraft/simc-addon/blob/master/extras.lua)
- [SimulationCraft equipment profile syntax](https://github.com/simulationcraft/simc/wiki/Equipment)

### The Blizzard talent token inside the profile

The `talents=` value is itself a versioned binary protocol represented with
Blizzard's export alphabet. It contains:

- an 8-bit serialization version;
- a 16-bit specialization ID;
- a 128-bit tree hash;
- variable-width state for every talent-tree node, in ascending node-ID order.

For each node, the stream records selection, purchased/granted state, partial
rank information, and choice-node selection. It does **not** carry the node IDs,
all entry IDs, node maximum ranks, or the complete node ordering. Those come
from the game data returned by `C_Traits`. Therefore a browser can read the
header without a game-data snapshot, but it cannot reliably turn the rest into
`(nodeId, entryId, rank)` triples without the matching tree definition.

The tree hash is Blizzard's strongest compatibility key, but it is produced by
the runtime-only `C_Traits.GetTreeHash` API and is not present in public DB2
data. The decoder preserves it and enforces it for exact-hash fixtures. Generated
production data instead uses the serialization version, specialization, WoW
patch, complete node order, rank bounds, and trailing-bit validation.

Sources:

- [Blizzard `ClassTalentImportExportMixin` source mirror](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_PlayerSpells/ClassTalents/Blizzard_ClassTalentImportExport.lua)
- [SimulationCraft addon's matching export implementation](https://github.com/simulationcraft/simc-addon/blob/master/core.lua)

### Retail log-format V22 `COMBATANT_INFO`

Retail format V22 is a mixed format: a scalar CSV prefix followed by nested
arrays and tuples. The current shape is:

```text
COMBATANT_INFO,
  playerGuid,
  faction,
  character stats and ratings,
  armor,
  patch-specific scalar(s),
  specId,
  [(nodeId,entryId,rank),...],
  (pvpTalentId,...),
  [(itemId,itemLevel,(enchants),(bonusIds),(gemId,gemItemLevel,...)),...],
  [active aura data],
  trailing expansion fields
```

Important protocol properties for this app are:

- it is emitted after encounter start, once per player;
- its player GUID is the join key to the player's combat events;
- secondary stats are rating values at the time of the event, not percentages;
- current talents use `(nodeId, entryId, rank)` triples, and the middle value is
  the trait-node entry ID rather than a spell ID;
- equipment is positional and includes item ID, effective item level, three
  enchant positions, bonus IDs, and gem ID/item-level pairs;
- auras describe pull-time state and therefore cannot be reconstructed from a
  static character profile alone;
- exact scalar offsets have changed between major patches, so the builder must
  be selected by combat-log schema/build rather than treated as timeless.

The checked-in 12.1 fixture also has four scalar values after the aura array.
Their meaning should remain opaque until verified; the V22 builder should copy
only a version-specific, tested default tail rather than giving those fields
invented names.

Sources:

- [Blizzard's original format announcement](https://www.bluetracker.gg/wow/topic/us-en/20419432775-new-logging-feature-combatant-info/)
- [WowCoach format-V22 `COMBATANT_INFO` reference](https://wowcoach.gg/docs/combat-log/combatant-info)
- [WowCoach machine-readable format-V22 specification](https://wowcoach.gg/docs/combat-log/spec.yaml)
- [Warcraft Logs `CombatantInfoEvent` contract](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.CombatantInfoEvent.html)

### Fidelity gap

The profile does not contain all values required by the log event. The MVP
must use the following provenance policy:

| `COMBATANT_INFO` section     | Profile source                                                              | MVP policy                                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Player GUID                  | Not in normal addon output                                                  | Use `session.player.guid`; never the reference GUID.                                                                                                                                                                                     |
| Faction                      | Race is present, faction is not                                             | Derive only for unambiguous races. For a neutral/ambiguous race, require an Alliance/Horde choice and bind it to the imported profile; never guess.                                                                                      |
| Live primary/secondary stats | Not present                                                                 | Emit documented sentinel/default values from the V22 builder and mark the stats section `defaulted`. Do not copy the reference character's ratings.                                                                                      |
| Armor                        | Not present as a profile-wide value                                         | Default it with the other live stats. Do not confuse it with item armor or an advanced-event block.                                                                                                                                      |
| Spec ID                      | Encoded in the talent header; textual `spec` is also present                | Decode the header and cross-check class/spec text. A conflict is an error.                                                                                                                                                               |
| Talent triples               | Encoded by position and bits, without tree definitions                      | Decode against checked-in generated live data matching serialization version, spec, and WoW patch; enforce an exact hash when a trusted one is installed.                                                                                |
| PvP talents                  | Not exported by the addon                                                   | Emit the adapter's tested empty/default representation and mark it `defaulted`. The current fixtures use a leading `0`, so do not assume that `()` is valid.                                                                             |
| Equipped item IDs            | Present                                                                     | Use exact active equipment lines only. Ignore commented bag/reward/linked items.                                                                                                                                                         |
| Effective item levels        | Usually present only in generated comments; can be explicit in generic SimC | Associate the official immediately preceding `# Name (N)` comment or explicit `ilevel=N` with its active slot. Parsing warns when a level is missing, and profile-backed building fails rather than emitting an unverified `0` sentinel. |
| Enchants and bonus IDs       | Present where applicable                                                    | Preserve numeric IDs in protocol order. Fill the unused enchant positions with `0`.                                                                                                                                                      |
| Gem IDs                      | Present                                                                     | Preserve exact gem IDs. Gem item levels are not exported; use a tested sentinel and mark that subfield `defaulted`.                                                                                                                      |
| Pull-time auras              | Not present                                                                 | Emit an empty array. Do not infer food, flask, temporary enchants, or proc state.                                                                                                                                                        |
| Trailing expansion fields    | Not represented                                                             | Use only the schema-specific tested V22 default tail.                                                                                                                                                                                    |

This produces a character-consistent identity/spec/talent/equipment record, not
an exact snapshot of every live pull-time value. The UI and export diagnostics
must say that plainly.

## Proposed contracts and modules

Add a pure core package under `src/core/simc/`:

```ts
interface SimcAddonProvenance {
  readonly addonVersion?: string;
  readonly wowVersion?: string;
  readonly wowBuild?: string;
  readonly tocVersion?: number;
}

interface SimcEquippedItem {
  readonly slot: SimcEquipmentSlot;
  readonly itemId: number;
  readonly itemLevel?: number;
  readonly enchantId?: number;
  readonly gemIds: readonly number[];
  readonly bonusIds: readonly number[];
  readonly options: Readonly<Record<string, string>>;
}

interface ParsedSimcAddonProfile {
  readonly provenance: SimcAddonProvenance;
  readonly characterName: string;
  readonly class: WowClass;
  readonly level: number;
  readonly race: string;
  readonly region: string;
  readonly server: string;
  readonly spec: string;
  readonly talentExport: string;
  readonly equipment: readonly SimcEquippedItem[];
}
```

Add `src/core/combatantInfo/` with a build-specific adapter interface:

```ts
interface CombatantInfoBuildAdapter {
  readonly schemaId: string;
  parseTalentExport(value: string): OperationResult<DecodedTalentLoadout>;
  build(
    player: Pick<Actor, "guid" | "name">,
    profile: ParsedSimcAddonProfile,
  ): OperationResult<BuiltCombatantInfo>;
}

interface BuiltCombatantInfo {
  readonly eventPayload: string; // starts with COMBATANT_INFO,
  readonly provenance: {
    readonly identity: "exact";
    readonly spec: "exact";
    readonly talents: "exact";
    readonly equipment: "exact" | "partial";
    readonly stats: "defaulted";
    readonly auras: "defaulted";
  };
}
```

Use typed warning/failure codes rather than free-form exceptions. At minimum:

- `SIMC_PROFILE_TOO_LARGE`
- `SIMC_PROFILE_MALFORMED`
- `SIMC_PROFILE_NOT_ADDON_EXPORT`
- `SIMC_MULTIPLE_ACTIVE_CHARACTERS`
- `SIMC_MISSING_REQUIRED_FIELD`
- `SIMC_CHARACTER_MISMATCH`
- `SIMC_CLASS_SPEC_MISMATCH`
- `SIMC_UNSUPPORTED_WOW_BUILD`
- `SIMC_UNSUPPORTED_TALENT_SERIALIZATION`
- `SIMC_TALENT_TREE_HASH_MISMATCH`
- `SIMC_MISSING_ITEM_LEVEL`
- `SIMC_DEFAULTED_COMBATANT_STATS`
- `SIMC_DEFAULTED_COMBATANT_AURAS`

Extend encounter export options without adding profile data to `Session`:

```ts
interface EncounterLogExportOptions extends SessionExportOptions {
  readonly combatantInfo: BuiltCombatantInfo;
}
```

Keeping the import out of `Session` avoids changing session JSON v1 and its
schema for export-only input. It also prevents a pasted profile from being
duplicated into debug JSON. Passing only the selected actor identity to the
builder makes the boundary enforceable: the SimC adapter cannot inspect or
alter session events, targets, timings, statistics, or filtering decisions.

## Parsing and validation rules

Implement the addon-export subset, not the entire SimulationCraft language.
The accepted grammar should be small, deterministic, and bounded:

1. Normalize CRLF/LF and reject NUL or invalid Unicode.
2. Limit input to 256 KiB, 10,000 lines, and a bounded line length before
   allocating parsed collections.
3. Recognize provenance comments and exactly one uncommented class declaration.
4. Parse `key=value` lines with quoted character names and comma-separated item
   options. Preserve unknown item options for forward-compatible diagnostics,
   but do not interpret them.
5. Ignore blank lines and comments for behavior, except for the official
   provenance and immediately preceding equipped-item-level comment.
6. Ignore commented saved talents, bag gear, weekly rewards, merchant gear, and
   linked gear. They must never override the active loadout/equipment.
7. Require the character declaration, level, race, region, server, spec,
   `talents`, and at least one active equipped item.
8. Reject duplicate active character declarations and conflicting duplicate
   scalar fields. Reject duplicate active equipment slots.
9. Parse numeric IDs as bounded safe integers; reject signs, decimals, empty
   slash components, and values outside the protocol range.
10. Compare the profile character name with the selected session player's
    character component. Normalize Unicode and remove only the combat-log realm
    suffix; do not fuzzy-match unrelated names.
11. Compare the profile's WoW patch, talent serialization version,
    talent-header spec ID, textual class, and textual spec. A mismatched profile
    must not be used for export.

Return a sanitized summary to the UI. Never render the raw profile in technical
details, warnings, or thrown errors; it can contain character/server names and
a full gear inventory.

## Talent data and decoder

Add a development-time generator plus checked-in, compact runtime snapshots:

```text
scripts/generate-talent-data.mjs
src/core/combatantInfo/data/generated.ts
```

Each snapshot must contain only what decoding requires:

- WoW build and interface version;
- Blizzard loadout serialization version;
- spec ID;
- source/current builds and WoW patch version;
- nodes sorted by node ID;
- each node's ID, type, maximum ranks, ordered entry IDs, and tiered-entry rank
  metadata where applicable.

Generation is a maintainer operation and may fetch or extract pinned upstream
game data. Runtime parsing must use the checked-in snapshot and make no request.
Record source URLs/content hash, generation time, builds, and a SHA-256 of the
downloaded data in the generated provenance block.

Port Blizzard's bit ordering and export alphabet into a small decoder with
golden tests. Decode and validate the fixed header first, select the snapshot by
serialization version, spec ID, and WoW patch version, then decode exactly one
node state per snapshot node. Blizzard's 128-bit tree hash is runtime-only and
not available in public DB2 data; preserve the pasted value as provenance and
support exact-hash fixtures when a trusted value is available. Reject truncated
streams, impossible choice indexes, impossible ranks, trailing non-padding
bits, serialization mismatches, and unsupported tree-data versions.

Do not make `spec=<text>` the source of truth for the numeric spec ID. Use the
talent header, then use the textual field as a consistency check.

## `COMBATANT_INFO` construction

Add a structural serializer rather than building one interpolated string.
Internal tuple/array helpers should make balanced delimiters and numeric-only
leaves unavoidable.

For the first adapter, target exactly
`retail-12.1.0-project-1-log-22`, matching the current registered parser schema:

1. Use `session.player.guid` as `playerGuid`.
2. Derive or default faction according to the fidelity table.
3. Use adapter-owned V22 defaults for unavailable live stats. Keep every scalar
   position explicit and documented by offset.
4. Use the decoded talent header spec ID.
5. Serialize selected talent entries as `(nodeId,entryId,rank)` in node order.
6. Serialize the adapter's tested default PvP-talent tuple. Confirm whether
   V22 requires the leading `0` observed in the current fixtures.
7. Emit the adapter-declared number of positional equipment tuples in the
   combat-log order. The current reference fixture contains 18 tuples, while
   the addon exposes a 19-entry list that includes the legacy ammo slot, so the
   two orders must not be assumed identical. Confirm and document the mapping
   from paired fixtures. Use `(0,0,(),(),())` for empty protocol slots.
8. Preserve item ID, item level, enchant ID, bonus IDs, and gem IDs from the
   parsed profile. Fill only protocol fields absent from the profile with tested
   sentinels.
9. Emit an empty pull-time aura array.
10. Append the adapter's opaque, tested V22 expansion tail.
11. Parse the completed event through a new structural `COMBATANT_INFO`
    validator before returning it.

The validator must understand balanced `[]`/`()` groups instead of using the
generic flat CSV tokenizer. It should verify the scalar count, integer fields,
talent triple arity, the adapter's gear-entry count, equipment tuple arity,
enchant triplets, and balanced aura/tail sections. It can later be shared with
the normal combat log parser, but replacing the current lossless raw-field
behavior is not a prerequisite for this feature.

Change `serializeEncounterSessionLog` to choose one source in this order:

1. validated `BuiltCombatantInfo` supplied for this session/player;
2. otherwise fail with `SIMC_PROFILE_REQUIRED` before creating output.

The builder result is already bound to a player GUID. The serializer must still
assert that it equals `session.player.guid` before insertion. A mismatch is a
recoverable export failure, not a warning.

No other branch in `serializeEncounterSessionLog` may read the SimC profile or
the built character metadata. The existing event window, event ordering,
target-identity transposition, neutral-flag rewrite, advanced map-ID rewrite,
and wipe envelope must produce the same bytes before and after this feature for
the same `Session`, except for the single `COMBATANT_INFO` line and its related
warnings.

Profile-backed exports use warnings that accurately describe the remaining
defaults. The Razorgore zone/map/encounter compatibility envelope is still
synthetic and retains its own separate warning; character metadata and
encounter-envelope provenance are not conflated.

## UI and state behavior

Add a compact **Character profile** section to the result screen, before the
download action:

1. Explain: open the SimulationCraft addon in WoW, run `/simc`, copy all text,
   and paste it into the textarea.
2. Provide a labelled multiline textarea with paste-friendly sizing and no
   spellcheck/autocomplete.
3. Parse on explicit **Use profile** submission rather than every keystroke.
4. On success, show only a concise summary: character, class/spec, active
   loadout accepted, and number of equipped items.
5. On failure, keep focus on an error summary and give a specific correction,
   such as rerunning `/simc`, choosing the matching character, or updating the
   app for a new talent tree.
6. If race does not determine faction, show a required Alliance/Horde choice
   before accepting the profile.
7. Let the user replace or remove the profile.
8. Keep download disabled until a valid matching profile is present.

Store the parsed profile/built event only in reducer/application memory, keyed
to the selected player GUID. Keep it when choosing another attempt for the same
player, discard it on **Start over**, and do not reuse it after changing to a
different player unless identity validation is rerun. Do not use
`localStorage`, IndexedDB, cookies, URL parameters, analytics, or network calls.

The download success message should state that character metadata came from the
pasted profile. Warnings should distinguish:

- synthetic Razorgore encounter envelope;
- profile-backed but defaulted live stats/auras.

## Implementation sequence

### Phase 0: lock the real protocol with paired fixtures

- Capture sanitized `/simc` output and the genuine `COMBATANT_INFO` line for
  the same character, loadout, equipment, WoW build, and timestamp vicinity.
- Cover at least one simple single-rank tree, one multi-rank node, one choice
  node, one tiered node if present, empty equipment slots, two rings/trinkets,
  a two-handed weapon, dual wielding, enchants, sockets, and crafted gear.
- Include at least two classes/specs and one non-ASCII character/realm name.
- Record the exact WoW build, log version, addon version, and tree hashes in the
  fixture manifest.
- Use the pairs to confirm every V22 offset, the four trailing values, gear slot
  ordering, item-level comments, gem tuple shape, and which sentinel values
  Warcraft Logs/WowCoach accept.

This is the hard gate for implementation. The captured fixture proves one real
event shape but cannot prove the SimC-to-event mapping.

### Phase 1: profile parser and contracts

- Add the bounded parser under `src/core/simc/` and export its types/functions
  through `src/core/index.ts`.
- Add compact synthetic and sanitized real addon fixtures.
- Test LF/CRLF, Unicode, comments, missing item names, quoted names, active vs
  commented lines, duplicate/conflicting values, excessive input, unknown
  options, and every supported equipment option.
- Property/fuzz test that arbitrary input never throws or produces unbounded
  collections.

### Phase 2: talent decoder and build data

- Keep the automatic production data generator and checked-in 12.1 artifact
  current with `npm run talents:update`.
- Port the Blizzard export bitstream/alphabet reader.
- Decode paired fixtures to the exact triples in their genuine
  `COMBATANT_INFO` lines.
- Add negative golden cases for old/new serialization versions, wrong spec,
  wrong tree hash, corrupt base64/export characters, truncation, impossible
  choice indexes, and changed trees.

### Phase 3: V22 builder and exporter integration

- Add the build adapter, structural serializer, and structural validator.
- Split encounter-envelope warnings from character-metadata warnings.
- Extend encounter export/browser download options and thread the built event
  through `createSessionDownload` and `saveSessionDownload`.
- Assert that only one `COMBATANT_INFO` is emitted, immediately after
  `ENCOUNTER_START`, and that its GUID equals `session.player.guid`.
- Preserve deterministic byte output, size-limit behavior, filename behavior,
  target transposition, map rewriting, and wipe end state.

### Phase 4: result-screen profile workflow

- Extend `AnalyzerState`, actions, and result rendering with profile import,
  replace, remove, validation, and provenance status.
- Keep raw textarea text out of technical details and clear it on reset.
- Update reducer, jsdom, and browser tests for keyboard submission, focus,
  character mismatch, stale profile removal, successful profile download, and
  mandatory-profile download gating.
- Verify the textarea and errors with axe and the existing narrow-viewport
  smoke test.

### Phase 5: real upload and release gate

- Produce a profile-backed export and deliberately missing, malformed, and
  mismatched controls from the same session.
- Upload with the Archon client to Warcraft Logs and verify that the report
  recognizes the selected player, spec, talents, item IDs, item levels,
  enchants, bonuses, and gems.
- Send the accepted Warcraft Logs report through WowCoach and verify that the
  existing Razorgore compatibility behavior still works.
- Confirm that defaulted stats/auras do not cause rejection or misleading UI.
  If zero sentinels are not accepted, stop and add a versioned data-backed
  derivation; do not fall back to the reference player's values invisibly.
- Repeat production privacy audits to prove that pasted profile content causes
  no request, persistence, or artifact inclusion.
- Update `README.md`, `docs/ui-workflow.md`,
  `docs/extraction-and-exports.md`, `docs/architecture.md`, the release
  checklist, and the public usage guide.

## Test matrix

| Layer               | Required assertions                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile parser      | Official addon subset accepted; general/hostile SimC syntax rejected safely; active lines cannot be confused with commented alternatives.                                 |
| Talent decoder      | Header fields exact; supported generated data selected; node/entry/rank triples match paired genuine events.                                                              |
| Builder             | Correct GUID/spec, balanced nested grammar, adapter-declared gear positions, exact IDs, tested defaults, deterministic output.                                            |
| Exporter            | Exactly one supplied record in the verified envelope; missing/mismatched metadata fails before Blob creation; all non-`COMBATANT_INFO` event lines remain byte-identical. |
| Reducer/UI          | Import/replace/remove, matching character enforcement, same-character attempt reuse, reset clearing, accessible errors and focus.                                         |
| Browser/privacy     | No main-thread log parsing regression, no profile persistence, no profile-bearing request, object URL still revoked.                                                      |
| External acceptance | Archon upload succeeds; Warcraft Logs recognizes character metadata; WowCoach accepts the report.                                                                         |

Add a capture-wide regression that reparses each generated encounter log and
structurally validates its `COMBATANT_INFO`. Keep external upload verification
manual or gated because it changes external state and may depend on accounts;
record the tested report IDs and date in the release checklist without checking
private profile text into the repository.

## Maintenance and versioning

Treat talent trees and `COMBATANT_INFO` layouts like the existing combat-log
schemas:

- register adapters by schema ID/build range;
- keep data snapshots immutable and content-hashed;
- refresh generated tree data or add an adapter for a changed tree/field layout;
- fail closed for unsupported builds and keep encounter download unavailable;
- add a scheduled maintainer check that compares the current addon talent
  serialization version and supported WoW interface versions with checked-in
  manifests;
- never fetch live mutable game data in the production browser.

The provenance comments in `/simc` output are advisory, not sufficient by
themselves. Compatibility is established by the combat-log schema, WoW patch,
talent serialization version, spec ID, and passing structural validation. A
trusted exact tree hash strengthens that validation when available.

## Definition of done

- A valid matching `/simc` addon export produces a deterministic encounter log
  whose single `COMBATANT_INFO` GUID equals the selected session player GUID.
- Given the same `Session`, exports with and without a pasted profile differ
  only in the `COMBATANT_INFO` line and character-metadata warning text; all
  combat-derived lines remain byte-identical.
- Its spec, decoded talent triples, equipped item IDs, available item levels,
  enchant IDs, bonus IDs, and gem IDs match paired genuine-event fixtures.
- Every value absent from `/simc` is versioned, tested, and visibly reported as
  defaulted; no reference-player stat or identity leaks into a profile-backed
  event.
- Wrong-character, wrong-build, wrong-tree, malformed, and oversized inputs fail
  recoverably without creating a download.
- Missing character metadata fails before output and no debugging character is
  present in production code.
- Warcraft Logs and WowCoach accept the profile-backed output in a recorded
  manual A/B test.
- `npm run verify`, production build/audits, browser workflow tests,
  accessibility checks, and privacy checks all pass.
