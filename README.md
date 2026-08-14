# WoW Training Dummy Log Analyzer

A privacy-preserving browser application for extracting one character's
training-dummy attempt from a noisy World of Warcraft Retail combat log.

The current D00-D10 implementation provides the characterized fixture set, shared
TypeScript contracts, incremental UTF-8/line/CSV parser primitives, a registered
Retail 12.1.0 combat-log schema, canonical events and actors, the typed worker
boundary and lifecycle, bounded player/target/session discovery, detailed
streaming extraction and ownership-aware filtering, versioned JSON and lossless
filtered-log exports, and the complete accessible React file-to-export workflow.
The UI supports content-based picker/drop intake, recorder confirmation or full
character selection, per-character session grouping, cancellable two-pass
processing, multi-target summaries, warnings/debug disclosure, and local JSON
and filtered-log downloads.
D10 adds measured retained-data/export safety limits, production worker and
privacy audits, explicit capture-wide performance regressions, installed-Chrome
and Playwright engine-proxy workflows, axe accessibility automation, and a
narrow-viewport smoke test.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
npm run verify
npm run build
npm run audit:production
npx playwright install chromium firefox webkit
npm run test:browser:proxies
npm run test:browser:chrome
npm run preview
```

`npm run verify` checks formatting, type-aware lint rules (including a negative
unsafe-`any` fixture), strict TypeScript, compact tests, explicitly named
capture-wide tests, and the D10 retention/performance regression. Normal package installation
installs the committed Husky pre-commit hook; it runs staged formatting/linting
and a full typecheck. CI runs the same verification command and production build.

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

The production build in `dist/` contains only static HTML, CSS, and JavaScript.
Combat logs remain in the browser: there is no backend, analytics, persistence,
router, or external state-management layer.
