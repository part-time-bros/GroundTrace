# Progress

Phase status: NOT_STARTED / IN_PROGRESS / DONE / BLOCKED

- [x] Phase 0 — Bootstrap — **DONE**
- [x] Phase 1 — Test-claim verification — **DONE**
- [x] Phase 2 — Node provenance SDK — **DONE**
- [x] Phase 3 — React provenance SDK — **DONE**
- [x] Phase 4 — Correlation + classification — **DONE**
- [ ] Phase 5 — Browser overlay
- [ ] Phase 6 — Reference demo
- [ ] Phase 7 — CLI
- [ ] Phase 8 — Claude Code hook
- [ ] Phase 9 — Docs + final QA

## Blocked

(nothing yet)

## Log

- **Phase 0 — Bootstrap.** pnpm workspace (`packages/*`, `examples/*`), `tsconfig.base.json` (strict, ES2022, NodeNext), ESLint 10 + Prettier, MIT license, `.gitignore`. Five package stubs: `core`, `node`, `react`, `overlay`, `cli`. Acceptance: `pnpm install` clean (190 pkgs, 0 errors), `pnpm build` exit 0 across all 5 packages, `PROGRESS.md` + `DECISIONS.md` present.
- **Phase 1 — Test-claim verification.** `groundtrace verify-tests -- <cmd>` with pytest/vitest/jest summary parsers, the TEST CLAIM box, and honest nulls when nothing parses. 27 unit tests. Acceptance, all against real subprocesses: a deliberately failing 4-test vitest suite → `UNVERIFIED — 3 failures`; the CLI's own suite → `VERIFIED · 27 discovered · 27 passed`; `echo hi` → `INCONCLUSIVE`, counts null, nothing invented.
- **Phase 2 — Node provenance SDK.** `@groundtrace/node`: `runWithTrace`/`withTrace`/`withTraceSync` over `AsyncLocalStorage`, `instrumentedQuery`/`instrumentedGet`, `tracedFetch`, `traceRoute` for Next App Router, best-effort collector sink. 29 tests. Acceptance: two deliberately interleaved requests (one success, one throw) each hold exactly their own event and never the other's; a ten-request interleaved variant holds too; `withTrace` outside any `runWithTrace` returns the value, re-throws real errors, and records nothing.
- **Phase 3 — React provenance SDK.** `@groundtrace/react`: `useTruthValue`, `<Truth>`, `<TraceScope>`, `useTracedQuery`/`tracedFetchJson` (mints the `x-groundtrace-id` header), stack-based call-site capture, batched swappable transport. 20 component tests under jsdom. Acceptance: `<Truth id="x" source="/api/y">42</Truth>` renders `<span data-truth-id="x">42</span>`; three no-op re-renders report zero extra events while a value change reports exactly one more, including when the tracked value is a fresh object identity each render.
- **Phase 4 — Correlation + classification.** `@groundtrace/core`: `classify`/`classifyValue`/`buildReport` implementing §4's five rules in order, `EventStore`, a transport-agnostic collector handler, and the shared box-drawing tree renderer. 40 core tests + 9 integration tests. Acceptance: one passing fixture per status (VERIFIED, INDIRECT, FALLBACK, SYNTHETIC, UNTRACED); the integration suite drives a **real** `traceRoute` + `instrumentedGet` and a **really rendered** `useTruthValue` component through both toggle states — 100% confidence healthy, 0% with the failure simulated, and the same value moving 🟢 → 🟠.
