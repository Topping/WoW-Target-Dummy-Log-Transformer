# Architecture decisions

## ADR-001: React presentation over framework-independent processing

**Status:** Accepted for v0.2

**Date:** 2026-08-14

The application shell uses React 19 with Vite. React is limited to presentation
and application state in `src/ui`. Domain contracts live in `src/core` and use
no React or DOM APIs. Browser transport contracts live in `src/worker`; this is
the only boundary currently allowed to mention browser `File` objects.

The dependency direction is:

```text
ui -> worker protocol -> core contracts
```

Core never imports from worker or UI. Tests import core contracts in the Node
test environment to keep that boundary enforceable.

The Vite build uses relative asset paths (`base: './'`), so the generated
`dist/` directory is static and works at the repository-scoped GitHub Pages URL
without a runtime server. No backend, router, analytics, persistence, service
worker, or external state-management package is present.

Exact combat-log times use `bigint` counts of 100-microsecond ticks in memory.
The original timestamp text and fractional component are retained alongside the
ordering value. A later versioned JSON exporter will define the string encoding
for these integers rather than allowing implicit precision loss.
