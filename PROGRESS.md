# Progress

Phase status: NOT_STARTED / IN_PROGRESS / DONE / BLOCKED

- [x] Phase 0 — Bootstrap — **DONE**
- [ ] Phase 1 — Test-claim verification
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
