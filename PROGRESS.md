# Progress

Phase status: NOT_STARTED / IN_PROGRESS / DONE / BLOCKED

- [x] Phase 0 — Bootstrap — **DONE**
- [x] Phase 1 — Test-claim verification — **DONE**
- [x] Phase 2 — Node provenance SDK — **DONE**
- [x] Phase 3 — React provenance SDK — **DONE**
- [x] Phase 4 — Correlation + classification — **DONE**
- [x] Phase 5 — Browser overlay — **DONE**
- [x] Phase 6 — Reference demo — **DONE**
- [x] Phase 7 — CLI — **DONE**
- [x] Phase 8 — Claude Code hook — **DONE**
- [x] Phase 9 — Docs + final QA — **DONE**

## V2 (docs/V2_SPEC.md)

- [x] Phase 10 — Real DOM scan in `verify` — **DONE**
- [x] Phase 11 — MCP server — **DONE**
- [x] Phase 12 — Express/Fastify adapters — **DONE**
- [x] Phase 13 — Postgres adapter — **DONE**
- [x] Phase 14 — Automatic instrumentation — **DONE**
- [x] Phase 15 — Production-safe mode — **DONE**
- [x] Phase 16 — CI integration + blocking Stop hook — **DONE**
- [x] Phase 17 — Vue adapter — **DONE**
- [x] Phase 18 — V2 docs + final QA — **DONE**

## Blocked

Nothing. Two issues were hit and resolved rather than parked:

- The overlay reported `UNTRACED` on the first click against a cold dev server. Root cause was
  real (the collector route takes ~1s to compile, so the click's query beat the first client
  report) and is fixed by a flush handshake plus making the client transport awaitable.
- The `verify` end-to-end tests failed once in a fresh clone. Diagnosed to a stray `next dev`
  left over from an earlier screenshot run — Next 16 refuses a second dev server for the same
  directory, so the spawned app never started. Not a product defect, but `verify` now includes
  the app's own output in its failure message instead of only "never became reachable".

## Log

- **Phase 0 — Bootstrap.** pnpm workspace (`packages/*`, `examples/*`), `tsconfig.base.json` (strict, ES2022, NodeNext), ESLint 10 + Prettier, MIT license, `.gitignore`. Five package stubs: `core`, `node`, `react`, `overlay`, `cli`. Acceptance: `pnpm install` clean (190 pkgs, 0 errors), `pnpm build` exit 0 across all 5 packages, `PROGRESS.md` + `DECISIONS.md` present.
- **Phase 1 — Test-claim verification.** `groundtrace verify-tests -- <cmd>` with pytest/vitest/jest summary parsers, the TEST CLAIM box, and honest nulls when nothing parses. 27 unit tests. Acceptance, all against real subprocesses: a deliberately failing 4-test vitest suite → `UNVERIFIED — 3 failures`; the CLI's own suite → `VERIFIED · 27 discovered · 27 passed`; `echo hi` → `INCONCLUSIVE`, counts null, nothing invented.
- **Phase 2 — Node provenance SDK.** `@groundtrace/node`: `runWithTrace`/`withTrace`/`withTraceSync` over `AsyncLocalStorage`, `instrumentedQuery`/`instrumentedGet`, `tracedFetch`, `traceRoute` for Next App Router, best-effort collector sink. 29 tests. Acceptance: two deliberately interleaved requests (one success, one throw) each hold exactly their own event and never the other's; a ten-request interleaved variant holds too; `withTrace` outside any `runWithTrace` returns the value, re-throws real errors, and records nothing.
- **Phase 3 — React provenance SDK.** `@groundtrace/react`: `useTruthValue`, `<Truth>`, `<TraceScope>`, `useTracedQuery`/`tracedFetchJson` (mints the `x-groundtrace-id` header), stack-based call-site capture, batched swappable transport. 20 component tests under jsdom. Acceptance: `<Truth id="x" source="/api/y">42</Truth>` renders `<span data-truth-id="x">42</span>`; three no-op re-renders report zero extra events while a value change reports exactly one more, including when the tracked value is a fresh object identity each render.
- **Phase 4 — Correlation + classification.** `@groundtrace/core`: `classify`/`classifyValue`/`buildReport` implementing §4's five rules in order, `EventStore`, a transport-agnostic collector handler, and the shared box-drawing tree renderer. 40 core tests + 9 integration tests. Acceptance: one passing fixture per status (VERIFIED, INDIRECT, FALLBACK, SYNTHETIC, UNTRACED); the integration suite drives a **real** `traceRoute` + `instrumentedGet` and a **really rendered** `useTruthValue` component through both toggle states — 100% confidence healthy, 0% with the failure simulated, and the same value moving 🟢 → 🟠.
- **Phase 5 — Browser overlay.** `@groundtrace/overlay`: shadow-DOM panel in the §5 terminal aesthetic (monospace, `└──` connectors, greyscale with the five status colours as the only colour), `bippy` used solely to name the component behind a clicked node, plus a self-mounting IIFE bundle for CLI injection. 17 jsdom tests. Acceptance: a VERIFIED click renders green ending at the real SQL; a FALLBACK click renders orange ending at the catch block and contains "not backed by live data" verbatim; Escape closes and returns focus to the value that opened it; the DEV MODE badge is on screen.
- **Phase 6 — Reference demo.** `examples/dashboard-demo`: Next 16 App Router (Node runtime), real seeded SQLite via better-sqlite3, `/api/revenue` wrapped in `traceRoute` + `instrumentedGet`, a live "Simulate API failure" toggle defaulting to on, and the collector hosted in-process so plain `pnpm dev` is enough. Acceptance, driven in a real Chromium: default state shows **$184,293** and clicking it gives 🟠 FALLBACK ending at "catch block returned a hardcoded value / upstream revenue service returned 503"; toggling shows **$96,159** — the actual `SUM(total)` of the seeded rows — and clicking gives 🟢 VERIFIED ending at the real SQL; growth shows 🟡 INDIRECT through `toPercent`; Escape closes; `/__groundtrace/report` reads 3 tracked, confidence 1. `next build` passes including TypeScript.
- **Phase 7 — CLI.** All five commands: `init` (with project-script detection), `run` (collector + overlay-injecting reverse proxy + app, one command, websockets forwarded), `verify-tests`, `verify` (build + tests + headless provenance scan), `report` (`--id`, `--json`). 68 CLI tests including the required both-states integration test. Acceptance: `groundtrace run --cwd examples/dashboard-demo` starts everything and the injected overlay works in a real browser through the proxy; `groundtrace verify` on the default state prints **0%** and names `revenue`, and **100%** with the failure switched off.
- **Phase 8 — Claude Code hook.** `groundtrace init --claude-code-hook` merges a `Stop` hook running `npx groundtrace verify --quiet || true`; informational only, never blocking. Acceptance, run for real against temp projects: a project with no `.claude/` gets one with valid JSON; a project with an existing unrelated `PostToolUse` hook keeps it (and its `permissions` block) untouched with `Stop` added alongside; an existing `Stop` hook is appended to, not clobbered; re-running is a no-op; an unparseable settings file is refused rather than overwritten.
- **Phase 9 — Docs + final QA.** Root README (pitch, before/after screenshot pair, install, two-minute quickstart, "how it works", license) plus a README per package, and real captured screenshots in `docs/media/`. Fresh name check: no npm registration for `groundtrace` or the `@groundtrace/*` scope, and no notable same-name project — the rename away from "TruthLens" still holds. Final QA run from a genuinely fresh `git clone`, not the working tree: `pnpm install`, `pnpm build` (packages **and** the Next demo), `pnpm test` (193), `pnpm lint` all clean, and the demo driven in a real browser from a cold start with no manual setup.

Producing the screenshots surfaced and fixed a real cold-start race: on a fresh dev server the collector route takes ~1s to compile, so the first click queried before the first client report landed and the overlay showed `UNTRACED`. The overlay now waits on the SDK's in-flight reports — which in turn required `defaultTransport` to return its request promise instead of firing it with `void fetch(...)`. Covered by a regression test.

## Completion pass

- [x] Truthful install docs + real CI — **DONE**
- [x] React Server Component support (`traceServerRender`, demo `/server`) — **DONE**
- [x] `@groundtrace/auto` validated against real markup — **DONE**
- [x] Overlay all-values summary (Alt+G) — **DONE**
- [x] Inline-literal SYNTHETIC detection — **DONE**
- [x] Interaction-aware `verify` — **DONE**
- [x] Multi-service trace propagation, demonstrated — **DONE**
- [x] Repo presentation: social preview, community health files, badges — **DONE**

311 tests. Two defects found by validating `auto` against the real demo rather than jsdom
fixtures: percentages never matched their source ratio, and `scan()` returned only the delta.

### V2 log

- **Phase 10 — Real DOM scan.** `verify` loads each route in a real browser (Playwright resolved at runtime, never a dependency) so the app's own SDK reports the values it rendered. Closes V1's one structural weakness: it can now *prove* a displayed number matches its source instead of verifying the server side and marking the value unobserved. The report states which basis it used. Acceptance: healthy demo → "matches what it returned" with `(rendered in a browser)`; `--no-browser` → the weaker basis, stated plainly; failure state → FALLBACK, 0%, under both.
- **Phase 11 — MCP server.** `@groundtrace/mcp` / `groundtrace-mcp` exposing `verify_app`, `list_tracked_values`, `explain_value`, `verify_tests`, `last_report` over stdio, plus `init --mcp` to register it. 16 tests driven through a real in-memory MCP client, and verified over real stdio against the demo. With no saved report the read-only tools error rather than returning something an agent could read as a pass.
- **Phase 12 — Express/Fastify adapters.** `groundtraceMiddleware`, `groundtraceFastify`, `withTracedRequest`. Tested against real Express 5 and Fastify 5 servers over real HTTP — which is how the double-report bug (`finish` *and* `close` both firing) was found.
- **Phase 13 — Postgres adapter.** `instrumentedQueryAsync` / `instrumentedGetAsync`, structurally typed against the `pg` client shape. An empty result is `VERIFIED`, not a fallback.
- **Phase 14 — Automatic instrumentation.** `@groundtrace/auto` tags displayed values by matching them against what traced sources recorded — zero SDK calls in the app. Reversed V2_SPEC's fiber-walk sketch in favour of DOM matching, which works for React, Vue, Svelte, and server-rendered HTML alike. Ambiguity is reported, never guessed.
- **Phase 15 — Production-safe mode.** Off unless explicitly enabled, deterministic sampling per trace id, values redacted to type + magnitude + digest. `valuesMatch` compares digests, so passthrough proof survives redaction while the figure never leaves the process.
- **Phase 16 — CI + blocking hook.** `--json`, `--fail-under <n>`, a reusable GitHub Action, and `--block` emitting Claude Code hook JSON. BUILD_SPEC §8 deferred blocking until the score had a basis; §10 is that basis, and it stays opt-in.
- **Phase 18 — V2 docs + QA.** V2_SPEC.md, README rewritten for the new capabilities, READMEs for the three new packages, and a fresh-clone verification.
