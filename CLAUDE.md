# GroundTrace — Autonomous Build Instructions

> This file is what Claude Code reloads every session, so it stays short by design (Anthropic's own docs say CLAUDE.md files over ~200 lines reduce instruction adherence). Everything detailed — architecture, phase-by-phase build notes, code sketches, the exact demo spec, acceptance criteria — lives in `docs/BUILD_SPEC.md`. Read that file in full once at the very start. After that, only re-read the section for whichever phase is currently active.

## What you're building

GroundTrace is a dev-mode debugger for React/Next.js apps that traces any displayed UI value back through **component → state → API → database**, and classifies what it finds as `VERIFIED`, `INDIRECT`, `FALLBACK`, `SYNTHETIC`, or `UNTRACED`. The headline capability: click a number on a web page and see exactly where it came from — including when it silently came from a `catch` block instead of the real API.

**Why this exists:** coding agents (Claude Code included) can produce a UI that looks complete — builds cleanly, renders, "tests pass" — while a failed request quietly fell back to mock data underneath. GroundTrace makes that gap visible instead of trusting the agent's own "Done ✅."

## Naming — read before you start

The idea that seeded this spec called the project "TruthLens." A same-name check turned up 7+ unrelated GitHub projects and a published ICML 2025 paper, all in fake-news / deepfake-detection — a real collision for npm, GitHub search, and branding. This spec uses **GroundTrace** instead. If you (the human reading this before handing it off, or Claude Code encountering it) still prefer TruthLens, it's a single find-and-replace across the repo — nothing below depends on the name itself.

## Operating rules — follow these before anything else

1. **Resume, don't restart.** First action, every session: read `PROGRESS.md` in the repo root. If it doesn't exist yet, create it from the template in `docs/BUILD_SPEC.md` §0. It tells you which phase is active and what's already done.
2. **Work the phases below in order.** Read that phase's section in `docs/BUILD_SPEC.md` before starting it. Don't move to phase N+1 until phase N's acceptance criteria (listed in that section) all pass.
3. **You have full authority to decide.** No one is watching this build in real time. When you hit a call the spec doesn't settle, pick the most reasonable option, write one line to `DECISIONS.md` explaining it, and keep moving. Do not stop and wait for input — there isn't any coming.
4. **Verify, don't assume done.** After each phase: run the build, run the tests, run the linter, and actually exercise the feature (e.g. click through the demo). Mark a phase `DONE` in `PROGRESS.md` only once its acceptance criteria are met, not once the code "looks right."
5. **If something breaks and ~5 fix attempts don't resolve it**, log it under a `## Blocked` heading in `PROGRESS.md` with what you tried, move to a phase that doesn't depend on it, and circle back later. Don't stall the whole run on one stuck phase.
6. **Commit after every phase** (`git init` first if this isn't a repo yet) with a message naming the phase, e.g. `phase 2: node provenance SDK`.
7. **Versions drift.** This spec was written August 2026. Before installing anything, check the real current stable version (`npm view <pkg> version`, or the tool's own release notes) rather than trusting a version number written below verbatim.

## Phases

| # | Phase | Ships | Detail |
|---|-------|-------|--------|
| 0 | Bootstrap | repo, tooling, `PROGRESS.md` / `DECISIONS.md` | BUILD_SPEC §0 |
| 1 | Test-claim verification | `groundtrace verify-tests` — wraps pytest/vitest, reports real evidence vs. claims | BUILD_SPEC §1 |
| 2 | Node provenance SDK | `@groundtrace/node` — request-scoped context, DB/fetch wrapper | BUILD_SPEC §2 |
| 3 | React provenance SDK | `@groundtrace/react` — `useTruthValue`, DOM tagging, source capture | BUILD_SPEC §3 |
| 4 | Correlation + classification | `@groundtrace/core` — stitches raw events into a provenance tree | BUILD_SPEC §4 |
| 5 | Browser overlay | click a tagged value in the running app, see its trace | BUILD_SPEC §5 |
| 6 | Reference demo | the broken revenue dashboard — this *is* the killer demo | BUILD_SPEC §6 |
| 7 | CLI | `groundtrace init / run / verify / report`, wiring everything together | BUILD_SPEC §7 |
| 8 | Claude Code hook | a `Stop` hook that prints a confidence report after Claude finishes a task | BUILD_SPEC §8 |
| 9 | Docs + final QA | README, full run-through against Definition of Done | BUILD_SPEC §9 |

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 (Active LTS as of this writing) | verify current LTS before installing |
| Package manager | pnpm workspaces (no Turborepo in V1) | too few packages yet to need build orchestration |
| Language | TypeScript, strict mode | |
| Demo framework | Next.js, App Router, **Node runtime, not Edge** | Edge complicates the `AsyncLocalStorage` context propagation §2 depends on |
| Demo database | SQLite via `better-sqlite3` | real queries and real latency, zero external services to fail in an unattended build |
| Test runner | Vitest | |
| React internals access | `bippy` (npm) | see BUILD_SPEC §3 — avoids needing a custom Babel/SWC compiler plugin for V1 |
| License | MIT | |

## Non-goals for V1

Do not build these now — they're deferred to the roadmap in `docs/BUILD_SPEC.md`:
- No VSCode extension
- No automatic zero-config instrumentation — V1 is explicit, opt-in SDK calls, not a compiler plugin that rewrites arbitrary code
- No Vue, Svelte, or Express adapters
- No production-safe mode — this is a dev-mode tool; the overlay should say so on screen
- No hosted dashboard, accounts, or SaaS backend

## Definition of done

- Every phase marked `DONE` in `PROGRESS.md`
- `pnpm build` and `pnpm test` pass clean from a fresh clone
- The demo app runs, and toggling `SIMULATE_API_FAILURE` visibly flips the dashboard between 🟢 `VERIFIED` and 🟠 `FALLBACK`
- Clicking the revenue number shows the full provenance chain correctly in both states
- README has the pitch, a before/after walkthrough worth turning into a GIF, and install steps
- Full checklist: `docs/BUILD_SPEC.md` §9

**Now: read `docs/BUILD_SPEC.md` in full, then start Phase 0.**
