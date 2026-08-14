# WoW Training Dummy Log Analyzer

A privacy-preserving browser application for extracting one character's
training-dummy attempt from a noisy World of Warcraft Retail combat log.

The current D00/D01 foundation provides the characterized fixture set, shared
TypeScript contracts, typed worker boundary, and accessible static React shell.
Parser and file-intake behavior will arrive in later delivery chunks.

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
[`docs/architecture.md`](docs/architecture.md).

The production build in `dist/` contains only static HTML, CSS, and JavaScript.
Combat logs remain in the browser: there is no backend, analytics, persistence,
router, or external state-management layer.
