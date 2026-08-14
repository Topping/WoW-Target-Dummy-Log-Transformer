# WoW Dummy Log Converter

A privacy-preserving browser application that turns one character's
training-dummy attempt from a noisy World of Warcraft Retail combat log into a
simulated encounter log for use with encounter analysis tools.

The current D00-D11 implementation provides the characterized fixture set, shared
TypeScript contracts, incremental UTF-8/line/CSV parser primitives, a registered
Retail 12.1.0 combat-log schema, canonical events and actors, the typed worker
boundary and lifecycle, bounded player/target/session discovery, detailed
streaming extraction and ownership-aware filtering, versioned JSON and
WowCoach-compatible encounter-log serializers, and the complete accessible
React file-to-export workflow. The public UI is deliberately positioned as a
converter and offers only the encounter-log download; versioned JSON remains an
internal core capability.

The streamlined UI supports content-based picker/drop intake, automatic use of
a uniquely identified recorder, automatic processing when that recorder has one
Likely attempt, and explicit character or attempt choices only when the log is
ambiguous. Attempt cards have a direct **Use this attempt** action. Scanning and
processing show concise, cancellable progress, while the ready screen leads with
the encounter-log download and keeps attempt and technical data closed by
default. The local-processing trust message appears on the landing intake only,
with no standalone product header or “Browser only” badge above the task. A
short guide below the picker covers conversion, the `.txt` download, upload to
Warcraft Logs through the Archon desktop client, and using the resulting log
link with an encounter analysis tool. After intake, **Start over** returns to
the landing drop area instead of immediately reopening the system file picker.

The encounter-log export uses the manually verified WowCoach-compatible
Blackwing Lair/Razorgore envelope, transposes the selected dummy combat stream,
and reports the attempt as a wipe. The result screen accepts `/simc` addon text
as character metadata only; combat events, timing, targets, pets, ownership, and
filtering continue to come exclusively from the selected combat-log session.
Profile parsing, identity/schema binding, talent decoding, V22 construction,
and structural validation are implemented. Checked-in production talent data is
generated for all playable specializations from Raidbots' resolved live client
data; `npm run talents:update` discovers the current non-PTR retail build and
refreshes it without a local WoW installation. Encounter-log download requires
validated character metadata; the former fixed debugging character has been
removed. Paired genuine-event and external-upload evidence remains a release
validation item for the synthesized V22 metadata.
D10 adds measured retained-data/export safety limits, production worker and
privacy audits, explicit capture-wide performance regressions, installed-Chrome
and Playwright engine-proxy workflows, axe accessibility automation, and a
narrow-viewport smoke test.
D11 adds a gated four-file GitHub Pages artifact, repository-scoped production
browser validation, repeatable deployment and post-deployment smoke workflows,
and an explicit release/sign-off/rollback checklist. The application is live at
[`topping.github.io/WoW-Target-Dummy-Log-Transformer`](https://topping.github.io/WoW-Target-Dummy-Log-Transformer/).

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run talents:update
npm run dev
npm run verify
npm run build
npm run audit:production
npm run audit:pages
npx playwright install chromium firefox webkit
npm run test:browser:proxies
npm run test:browser:chrome
npm run test:browser:pages:proxies
npm run test:browser:pages:chrome
npm run preview
```

`npm run verify` checks formatting, type-aware lint rules (including a negative
unsafe-`any` fixture), strict TypeScript, compact tests, explicitly named
capture-wide tests, and the D10 retention/performance regression. Normal package installation
installs the committed Husky pre-commit hook; it runs staged formatting/linting
and a full typecheck. CI runs the same verification command and production build.

Talent data is checked in for browser-only runtime use. Maintainers refresh it
with `npm run talents:update`; `npm run talents:check` verifies that the artifact
matches the latest resolved live dataset. See
[`src/core/combatantInfo/data/README.md`](src/core/combatantInfo/data/README.md).

Capture inventory details and the non-mutating statistics command are documented
in [`docs/test-data.md`](docs/test-data.md). Architecture decisions are in
[`docs/architecture.md`](docs/architecture.md), and the concrete parser/schema
behavior is in [`docs/parser.md`](docs/parser.md).
Worker and pass-one discovery behavior is in
[`docs/worker-and-discovery.md`](docs/worker-and-discovery.md).
Detailed extraction, filtering, budgets, and exports are documented in
[`docs/extraction-and-exports.md`](docs/extraction-and-exports.md).
The concrete UI state machine and interactions are documented in
[`docs/ui-workflow.md`](docs/ui-workflow.md).
D10 measurements, browser-version distinctions, accessibility results, privacy
audit, defaults, and genuine gaps are in
[`docs/d10-hardening.md`](docs/d10-hardening.md).
The D11 deployment prerequisites, exact validation commands, artifact contract,
coverage matrix, accepted limitations, rollback steps, and deployed evidence
are in
[`docs/d11-release-checklist.md`](docs/d11-release-checklist.md).

The production build in `dist/` contains only static HTML, CSS, JavaScript, and
the separately emitted JavaScript parser worker.
Combat logs remain in the browser: there is no backend, analytics, persistence,
router, service worker, or external state-management layer. The landing screen
states this once as “Processed locally. Nothing is uploaded.”
