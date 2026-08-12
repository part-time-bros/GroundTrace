# Progress

Phase status: NOT_STARTED / IN_PROGRESS / DONE / BLOCKED

- [x] Phase 0 — Bootstrap — **DONE**
- [x] Phase 1 — Test-claim verification — **DONE**
- [ ] Phase 2 — Node provenance SDK
- [ ] Phase 3 — React provenance SDK
- [ ] Phase 4 — Correlation + classification
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
