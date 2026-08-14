# WoW Training Dummy Log Analyzer

A privacy-preserving browser application for extracting one character's
training-dummy attempt from a noisy World of Warcraft Retail combat log.

The current D00-D03 foundation provides the characterized fixture set, shared
TypeScript contracts, incremental UTF-8/line/CSV parser primitives, a registered
Retail 12.1.0 combat-log schema, canonical events and actors, the typed worker
boundary, and an accessible static React shell. Browser worker lifecycle, file
intake, discovery, filtering, and export behavior remain later delivery chunks.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
npm run verify
npm run build
npm run preview
```

`npm run verify` checks formatting, type-aware lint rules (including a negative
unsafe-`any` fixture), strict TypeScript, and tests. Normal package installation
installs the committed Husky pre-commit hook; it runs staged formatting/linting
and a full typecheck. CI runs the same verification command and production build.

Capture inventory details and the non-mutating statistics command are documented
in [`docs/test-data.md`](docs/test-data.md). Architecture decisions are in
[`docs/architecture.md`](docs/architecture.md), and the concrete parser/schema
behavior is in [`docs/parser.md`](docs/parser.md).

The production build in `dist/` contains only static HTML, CSS, and JavaScript.
Combat logs remain in the browser: there is no backend, analytics, persistence,
router, or external state-management layer.
