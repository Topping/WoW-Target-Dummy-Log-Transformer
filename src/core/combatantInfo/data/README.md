# Talent tree runtime data

`generated.ts` is produced by `npm run talents:update`; do not edit it by hand.
The generator automatically discovers the production retail build (the `wow`
product, never PTR/beta), downloads Raidbots' resolved live metadata and talent
data, validates all 40 playable specializations, and writes the compact runtime
artifact consumed by `installed.ts`.

Raidbots' data is generated from client DB2 data using SimulationCraft's
extractors and already resolves the spec/tree and conditional-entry details
that are easy to get wrong when joining raw DB2 tables. The generator pins the
download through Raidbots' content hash and records source URLs, builds, time,
and SHA-256 provenance in generated source comments/data.

```sh
npm run talents:update
npm run talents:check
```

The update command needs network access only during development/release. The
browser bundles the checked-in generated artifact and performs no runtime
request. `--build x.y.z.build` is available for reproducible historical runs;
the normal update command needs no build argument.

Blizzard's 128-bit tree checksum is exposed only by the in-game
`C_Traits.GetTreeHash` API and is not present in public DB2 data. Generated
snapshots are therefore selected by the SimC profile's WoW patch version and
specialization, while the decoder still validates the complete bitstream
structure. Exact-hash snapshots remain supported for fixtures and additional
validation when a trusted hash is available.

Sources:

- [Raidbots static-data documentation](https://www.raidbots.com/developers)
- [Wago.tools production build feed](https://wago.tools/api/builds/latest)
- [Blizzard talent import/export format source mirror](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_PlayerSpells/ClassTalents/Blizzard_ClassTalentImportExport.lua)
