# Test data and approved capture labels

The fixture inventory is machine-readable at
[`data/fixtures.manifest.json`](../data/fixtures.manifest.json) and validated by
[`docs/fixture-manifest.schema.json`](fixture-manifest.schema.json). Descriptive
statistics and manually approved labels deliberately live in separate manifest
sections. The statistics tool reports observations; it has no option that writes
or updates ground truth.

## Provenance terms

- **Real** is an unchanged WoW Retail capture. It contains the names and GUIDs
  that were visible to the recorder and may include nearby players.
- **Derived** is a compact excerpt or shape-preserving reduction of a real
  capture. The manifest identifies its source and any identity replacement or
  payload reduction.
- **Synthetic** is invented test data. It must never be presented as an actual
  capture or used as the only evidence for real-world behavior.

All captures use Retail project 1, combat-log version 22, build 12.1.0, Advanced
Combat Logging enabled, and four fractional timestamp digits. Raw captures are
development-only test material: do not publish them outside the repository or
add captures without the permission of the recorder and visible participants.

## Real captures

| Fixture                      | Size / records / range                                        | Purpose and approved result                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/dummy-encounter.txt`   | 28,880,428 bytes; 89,921 records; 11:47:33.8072–11:56:44.0452 | Main noisy single-target and filtering capture. Pølsefatter's representative direct-action window against Dungeoneer's Training Dummy is 11:47:38.3082–11:51:36.5472. It also contains three recorder-affiliated Risen Ghoul instances, Unicode names, nearby-player noise, advanced fields, and external heals. |
| `data/cleave-logs.txt`       | 2,290,979 bytes; 7,462 records; 12:46:19.2612–12:48:04.9562   | Real multi-target attempt. The approved Pølsefatter window is 12:46:23.3732–12:47:50.7862: 913 qualifying records across five Cleave Training Dummy GUIDs, lasting 87.413 seconds. Its largest internal qualifying gap is 1.974 seconds, so it is one continuous attempt.                                        |
| `data/session-splitting.txt` | 1,406,938 bytes; 4,591 records; 12:48:57.7862–12:50:45.7212   | Real gap-splitting capture with nearby-player noise. At the approved 10-second threshold, direct Pølsefatter activity against the Dungeoneer's Training Dummy forms the four groups below.                                                                                                                       |
| `data/boss-encounter.txt`    | 47,102 bytes; 172 records; 12:08:52.7962–12:10:05.5132        | Genuine boss reference. It contains two Razorgore encounter envelopes and two `COMBATANT_INFO` records. It proves encounter metadata exists and is the negative case that dummy discovery must not classify as training.                                                                                         |

The complete event-type distributions, SHA-256 checksums, player-character set,
dummy GUID set, and encounter labels are in the manifest. Listing every noisy
actor here would make this document harder to audit, while the JSON remains a
stable test input.

### Confirmed split groups

The manifest's `player-to-labelled-target-v1` profile excludes the duplicate
`SWING_DAMAGE_LANDED`, terminal `SPELL_AURA_REMOVED`, and dose-only
`SPELL_AURA_APPLIED_DOSE` records. Those exclusions describe this manual label;
they are not an implementation of the future discovery heuristic.

| Group | Start         | End           | Qualifying records | Gap before next |
| ----- | ------------- | ------------- | -----------------: | --------------: |
| 1     | 12:49:00.8762 | 12:49:04.0662 |                  3 |        20.264 s |
| 2     | 12:49:24.3302 | 12:49:27.5752 |                  5 |        33.489 s |
| 3     | 12:50:01.0642 | 12:50:01.1762 |                  4 |        25.130 s |
| 4     | 12:50:26.3062 | 12:50:26.5722 |                  3 |               — |

### Confirmed cleave target set

The one continuous cleave attempt affects five targets. The manifest records
their stable GUIDs and the per-capture inventory; no single focus target is
required. This is the ground-truth case that keeps `Session.targets` non-empty
and plural in the shared contract.

## Compact fixtures

| Fixture                                             | Provenance | Purpose                                                                                                                                                     |
| --------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/fixtures/derived/current-retail-samples.log` | Derived    | Exact timestamp precision, quoted CSV text, Unicode, `nil`, advanced fields, summon data, and a generic/unsupported event. One nearby identity is replaced. |
| `tests/fixtures/derived/encounter-envelope.log`     | Derived    | Encounter start/end metadata and a reduced, structurally representative `COMBATANT_INFO` payload.                                                           |
| `tests/fixtures/synthetic/external-effect.log`      | Synthetic  | Minimal isolated player/dummy activity and an unrelated player's external buff on the selected player.                                                      |
| `tests/fixtures/synthetic/missing-ownership.log`    | Synthetic  | A summon edge plus a same-named creature with no owner evidence; names alone must not establish ownership.                                                  |

Unit tests should use these compact fixtures. The 28.9 MB noisy capture belongs
only in the single capture-inventory smoke test and future explicit integration
or end-to-end suites; it must not be imported into every parser unit test.

## Capture A–E coverage gaps

The real environment could not produce an isolated training area, which is
valid product input rather than a defective capture.

| Requested capture          | Current coverage                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A — minimal dummy          | Synthetic minimal/external fixture only; no isolated real capture.                                          |
| B — real dummy environment | `dummy-encounter.txt`, with realistic nearby noise.                                                         |
| C — session splitting      | `session-splitting.txt`, four short confirmed groups rather than the originally suggested two long groups.  |
| D — genuine encounter      | `boss-encounter.txt`, same recorder and build, with two envelopes.                                          |
| E — pets/summons           | Risen Ghoul ownership in `dummy-encounter.txt`; not an exhaustive capture of every class or specialization. |

## Reproducing descriptive statistics

From the repository root:

```sh
npm run captures:stats
npm run captures:stats -- data/cleave-logs.txt
```

The command streams files, reports size, SHA-256, record/time ranges, version,
event counts, actor/dummy candidates, and encounter-envelope events as JSON on
standard output. It never loads a whole capture into one string and never writes
`data/fixtures.manifest.json`. Updating approved ground truth is an explicit,
reviewed edit to the manifest followed by `npm test`.

## Adding a fixture

1. Obtain permission and decide whether the data is real, derived, or synthetic.
2. Minimize it where possible; replace unrelated identities in derived excerpts
   without changing the field shape under test.
3. Add provenance, source paths, purpose, and sanitization notes to the manifest.
4. Run `npm run captures:stats -- path/to/file` and manually review the report.
5. Add only reviewed expectations to `approvedGroundTruth`; never copy an
   algorithm's discovery output into golden labels without independent review.
6. Add the lowest-level test that needs the fixture. Keep large captures in
   explicit smoke/integration suites.
