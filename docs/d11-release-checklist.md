# D11 static GitHub Pages release

- **Prepared:** 2026-08-14
- **Deployed URL:**
  `https://topping.github.io/WoW-Target-Dummy-Log-Transformer/`
- **Repository path:** `/WoW-Target-Dummy-Log-Transformer/`
- **Release status:** deployed and verified. Quality, repository-scoped
  validation, deployment, deployed proxy-engine smoke, and deployed genuine
  installed-Chrome smoke passed for release commit
  `7c9ff05c38dc1f3a4d11674bf4371e56a7ef72c7`.

This is the historical release checklist and evidence record for D11. Its
commit SHA, artifact sizes, run counts, two-export workflow, and sign-off record
the interface deployed on 2026-08-14 and must not be read as claims about the
current public controls. It does not replace the D10 measurements or broaden
their browser-certification claims.

## Current public UX contract

The public application now centers the conversion job rather than exposing the
full analyzer pipeline:

- one detected recording character proceeds without a recorder-confirmation
  screen; ambiguous logs still show the complete character choice;
- one unique likely attempt is processed automatically; when there is no unique
  likely attempt, the available cards provide a direct **Use this attempt**
  action;
- scanning and processing keep truthful semantic progress and cancellation with
  compact copy;
- the result leads with **Download encounter log**, while attempt statistics and
  technical/debug information are closed by default;
- session JSON remains a tested internal/core serialization capability but is
  not a public download;
- there is no standalone product header or “Browser only” badge, and local-processing privacy is stated
  once near intake rather than repeated across the page.

New release-candidate and deployed smoke runs should exercise this streamlined
path. The older recorder-confirmation and two-download results below remain
valid historical evidence for their recorded commit only.

## Final release decisions

The release is one Vite entry document, one hashed stylesheet, one hashed
application module, and one separately emitted hashed parser worker:

```text
index.html
assets/index-<hash>.css
assets/index-<hash>.js
assets/parser.worker-<hash>.js
```

`vite.config.ts` keeps `base: "./"`. The entry document therefore references
its CSS and application module relative to the repository-scoped document, and
the built application resolves the worker relative to its emitted application
module. No router or fallback document is needed: the only application route is
the repository root. Direct loading and refreshing that URL reloads the waiting
state; arbitrary child routes are not supported and may return GitHub Pages
404, which is an accepted v0.2 limitation.

`scripts/audit-pages-artifact.mjs` requires exactly the four files above. It
rejects additional files, symlinks, source maps and source-map references,
capture/log/environment files, representative real-capture identities, and
common private-key/token signatures. `npm run audit:production` independently
rejects non-HTML/CSS/JavaScript output and runtime network, persistence,
service-worker, analytics, and URL-mutation paths.

The local `scripts/serve-pages-artifact.mjs` server is development/test tooling
only. It faithfully mounts `dist/` at the configured repository path and is
excluded from the artifact by the four-file allowlist. The deployed product has
no runtime server.

## Workflow behavior and deployment prerequisites

`.github/workflows/quality.yml` runs, in order:

```sh
npm ci
npm run verify
npm run build
npm run audit:production
npm run audit:pages
```

`.github/workflows/pages.yml` runs on a push to `main` or manual dispatch. Its
validation job repeats those same gates, installs Playwright Chromium, Firefox,
and WebKit, and runs the full browser suite against the locally mounted
repository-scoped artifact. Only then does it upload `dist/` with the official
Pages artifact action. The deployment job has only `pages: write` and
`id-token: write` in addition to the workflow's read-only content permission.
The final job runs the direct-load/reload test and the complete real-cleave
file-to-encounter-log/privacy workflow against the URL returned by the
deployment action in all three Playwright proxy engines. The first deployment
evidence later in this document predates the streamlined UI and therefore
records the then-public two-export workflow.

The repository owner must complete or confirm these GitHub-side prerequisites:

1. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as
   the source before the first run. The workflow's normal `GITHUB_TOKEN` cannot
   enable Pages for a repository where it is disabled.
2. Push the reviewed D11 changes to `main` or manually dispatch the workflow.
3. Confirm Actions are enabled and the workflow `GITHUB_TOKEN` may create Pages
   deployments. No repository secret is required.
4. Review any protection rules on the `github-pages` environment and approve
   the deployment if those rules require it.
5. Record the successful workflow URL, deployed commit SHA, returned Pages URL,
   and post-deployment smoke result in the sign-off section below.

These settings cannot be changed or verified from an unauthenticated local
checkout. Branch-protection settings also require authenticated repository
access and were not inferred from their unavailable public API response.

## Exact local validation and reproduction

Use Node.js 22 or newer from a clean checkout:

```sh
npm ci
npm run verify
npm run build
npm run audit:production
npm run audit:pages
npx playwright install chromium firefox webkit
npm run test:browser:pages:proxies
npm run test:browser:pages:chrome
```

The installed-Chrome command is separate so its evidence cannot be confused
with the Chromium proxy. If installed Chrome is unavailable, record that as a
gap rather than silently substituting Chromium.

To inspect the exact artifact and reproduce its Pages path manually:

```sh
find dist -type f -print
PAGES_BASE_PATH=/WoW-Target-Dummy-Log-Transformer/ npm run preview:pages
```

Then open:

```text
http://127.0.0.1:4173/WoW-Target-Dummy-Log-Transformer/
```

After a real deployment, rerun the release smoke without a local server:

```sh
PLAYWRIGHT_BASE_URL=https://topping.github.io/WoW-Target-Dummy-Log-Transformer/ \
  npx playwright test \
  tests/browser/pages-release.spec.ts \
  tests/browser/workflow.spec.ts \
  --project=chromium-proxy \
  --project=firefox-proxy \
  --project=webkit-proxy
```

## Local release-candidate evidence (historical D11 run)

The final local run on 2026-08-14 produced:

- `npm run verify`: 151 compact tests, 8 explicitly named capture-wide tests,
  and 2 performance/retention tests passed after formatting, lint, negative
  lint, and strict typechecking passed;
- `npm run build`: four files—554-byte `index.html`, 230,408-byte application
  JavaScript, 7,276-byte CSS, and a 45,455-byte separate parser worker;
- `npm run audit:production`: passed for all four static artifacts;
- `npm run audit:pages`: passed the exact file/path, relative asset, worker,
  capture, map, and secret checks;
- `npm run test:browser:pages:proxies`: 17 passed and 4 intentionally skipped;
  Chromium proxy ran both large-capture smokes, while Firefox and WebKit each
  skipped those timing-sensitive cases under the preserved D10 routing;
- `npm run test:browser:pages:chrome`: 7/7 passed in the genuinely installed
  headless Chrome binary.

The observed proxy user agents were Chrome for Testing 151.0.7922.34, Firefox
153.0, and WebKit reporting Safari 26.5. Installed Chrome reported
`HeadlessChrome/151.0.0.0`. All four projects completed direct load, refresh,
repository-relative application assets and worker, accessibility states, the
real five-target workflow, downloaded-content assertions, and privacy checks.
These are local production-artifact results, not deployed-URL evidence.

## First deployment evidence (historical D11 run)

The repository owner selected GitHub Actions as the Pages source and explicitly
authorized publication. Commit
`7c9ff05c38dc1f3a4d11674bf4371e56a7ef72c7` was pushed to `main` on 2026-08-14.

- [Quality run 31808021980](https://github.com/Topping/WoW-Target-Dummy-Log-Transformer/actions/runs/31808021980):
  passed.
- [GitHub Pages run 31808022101](https://github.com/Topping/WoW-Target-Dummy-Log-Transformer/actions/runs/31808022101):
  `validate`, `deploy`, and `smoke-deployed` all passed.
- The deployed URL returned HTTP 200 with a `Last-Modified` value tied to the
  first deployment.
- The deployed CI smoke completed direct load, refresh, the full real-cleave
  file-to-both-exports workflow, accessibility checks, and privacy checks in
  Playwright Chromium, Firefox, and WebKit proxies.
- A separate deployed run in the genuinely installed headless Chrome 151 binary
  passed both `pages-release.spec.ts` and `workflow.spec.ts` (2/2).

This is genuine deployed-URL evidence. The proxy labels retain their D10
limitations and are not actual Edge, installed Firefox, or installed Safari
certification.

## v0.2 release coverage matrix (historical)

| Capability                                             | Release evidence                                                                 | Release status                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| Static browser app and local-only privacy              | Four-file artifact audit, production privacy audit, visible privacy card/footer  | Satisfied locally and deployed                      |
| Streaming, responsive, cancellable progress            | D04 worker tests, D10 capture-wide/performance and heartbeat suites              | Satisfied by D10; preserved                         |
| Current Retail parser, Unicode, unknown events         | Compact and explicitly named capture-wide parser suites                          | Satisfied by D02-D03; preserved                     |
| Character/target/attempt discovery and splitting       | Discovery unit and approved-ground-truth capture-wide suites                     | Satisfied by D05; preserved                         |
| Extraction, ownership, external effects, filtering     | Extraction and ownership tests plus capture-wide profiles                        | Satisfied by D06; preserved                         |
| JSON and filtered-log exports                          | Schema/round-trip tests and downloaded-content assertions in production browsers | Satisfied locally and deployed                      |
| Non-technical complete workflow and errors             | React tests and Playwright real-cleave/recovery suites                           | Satisfied locally and deployed                      |
| Parser tests independent of UI                         | `npm run verify` compact/capture-wide/performance routing                        | Satisfied; preserved                                |
| Accessibility                                          | D10 axe/keyboard/focus/narrow-view evidence in installed Chrome and proxies      | Satisfied locally/deployed within automation limits |
| Repository-scoped assets, worker, direct load, refresh | Artifact audit plus `pages-release.spec.ts` at the exact base path               | Satisfied locally and deployed                      |
| Deployed static URL and post-deploy workflow           | Pages deployment output and successful `smoke-deployed` job                      | Satisfied                                           |
| Synthetic encounter work                               | Explicitly outside D11                                                           | Not part of v0.2 release                            |

## Browser and privacy evidence to record

The D10 evidence remains: genuine installed headless Chrome 151 plus Playwright
Chromium, Firefox, and WebKit engine proxies. Playwright Firefox is not the
installed Firefox application, and Playwright WebKit is not installed Safari.
Microsoft Edge was not exercised. The Pages workflow intentionally labels its
projects `chromium-proxy`, `firefox-proxy`, and `webkit-proxy`; a green workflow
must not be reported as actual Edge, Firefox, or Safari certification.

For every current local release-candidate and deployed smoke run, confirm:

- the direct repository URL and refresh both load the waiting screen;
- HTML, CSS, application JavaScript, and the parser worker load below the same
  repository path;
- the real five-target capture completes file → discovery → automatic
  character routing → direct attempt choice when needed → processing → result →
  encounter-log download;
- the encounter-log download contains the retained log-version record, and no
  JSON download control is exposed in the public UI;
- a unique likely attempt bypasses attempt choice, while ambiguous character or
  attempt sets remain recoverable through explicit choices;
- progress remains accessible and truthful, the primary download is immediately
  visible on the result, and technical information is closed by default;
- there is no standalone product header or “Browser only” badge;
- after file intake, requests are bodyless same-origin GETs and include only the
  static parser-worker load—no combat GUID, name, or data appears in URLs;
- the URL remains unchanged; localStorage, sessionStorage, IndexedDB, cookies,
  and service-worker registrations remain empty; and no backend or analytics
  request occurs.

WebKit exposes the temporary `blob:` download through Playwright's request
observer, while Chromium and Firefox do not. The regression permits that local
protocol explicitly, applies same-origin repository-path rules to HTTP(S)
requests only, and still requires every request to have no body. A `blob:` URL
is in-memory browser transport, not a combat-data network request.

Large `data/dummy-encounter.txt` coverage remains confined to the explicitly
named capture-wide/performance and Chromium/installed-Chrome browser smoke
suites. The deployed artifact contains none of `data/`, `tests/`, `docs/`,
source code, repository metadata, source maps, environment files, or captures.

## SimulationCraft character-metadata release gate

The local parser, decoder, V22 builder/validator, export threading, and UI flow
must not be described as production-compatible character metadata until all of
the following evidence is recorded:

- a sanitized `/simc` profile and genuine `COMBATANT_INFO` from the same
  character/build/loadout/equipment snapshot;
- generated live tree data whose serialization version, spec ID, ordered nodes,
  and decoded triples match the genuine event;
- confirmed V22 equipment ordering, item/gem sentinel behavior, scalar offsets,
  and expansion tail;
- accepted Warcraft Logs and WowCoach uploads with report IDs and test date;
- a repeated privacy/browser audit showing no profile persistence or request.

`INSTALLED_TALENT_SNAPSHOTS` is generated for all playable specializations, but
that public data does not replace the paired-event and upload evidence above.
There is no fixed-character fallback. Synthetic tests do not satisfy this
release gate.

## Accepted limitations

- A refresh resets the in-memory workflow and requires reselecting the file.
- There is no child application route or SPA fallback; only the repository root
  is a valid direct-load URL.
- Mobile-sized layout is smoke-tested, but large-log processing on phones is
  not a primary v0.2 target.
- Actual Edge, installed Firefox, installed Safari, manual screen readers,
  high-contrast mode, and broader zoom/reflow remain unverified.
- Current performance/budget evidence is tied to the D10 host, fixtures, and
  versions and is not a universal performance promise.
- The deployed URL and GitHub CDN response were verified. Owner-only branch and
  environment protection details remain outside the unauthenticated checkout.

## Rollback

The normal rollback is a new deployment from a reviewed revert; do not rewrite
`main` history:

```sh
git log --oneline -- .github/workflows/pages.yml package.json vite.config.ts
git revert <bad-release-commit>
git push origin main
```

The revert push reruns every validation gate and deploys a new immutable
artifact from the previous application state. If an earlier successful Pages
workflow run and its artifact are still retained, rerunning that exact run is
an alternative after verifying its commit SHA. For an urgent privacy or
security incident, the repository owner may disable/unpublish Pages in
**Settings → Pages** while preparing the validated revert; record that outage
and re-enable only after the replacement workflow passes.

## Release sign-off

```text
Release commit SHA:      7c9ff05c38dc1f3a4d11674bf4371e56a7ef72c7
Quality workflow URL:    https://github.com/Topping/WoW-Target-Dummy-Log-Transformer/actions/runs/31808021980
Pages workflow URL:      https://github.com/Topping/WoW-Target-Dummy-Log-Transformer/actions/runs/31808022101
Deployed URL:            https://topping.github.io/WoW-Target-Dummy-Log-Transformer/
Post-deploy proxy smoke: PASSED
Installed Chrome smoke:  PASSED (2/2, HeadlessChrome/151.0.0.0)
Release authorization:   Repository owner explicitly authorized commit and push in the task conversation
Evidence recorded by:    Codex; this is an evidence sign-off, not a cryptographic signature
Signed date/time (UTC):  2026-08-14 14:13
Rollback commit SHA:     NOT USED
```
