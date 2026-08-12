# GroundTrace — Build Spec

Companion to `CLAUDE.md`. That file has the operating rules and phase index; this file has everything needed to actually execute each phase. Read this once in full at the start of the build. When resuming or moving to a new phase, you can re-read just that phase's section instead of the whole file.

---

## Research notes — why this spec looks the way it does

Keep this context; it prevents re-litigating settled decisions mid-build.

**Prior art.** The closest adjacent tools are: distributed tracing / APM (OpenTelemetry, Sentry, Datadog RUM) — these propagate trace context across a request but have no concept of "is this displayed value real or a fallback," and nothing surfaces as a click-a-DOM-value overlay; session/bug-evidence capture (Jam.dev — records video, console logs, network requests, and can hand that bundle to an LLM for triage) — collects evidence but doesn't build a per-value provenance chain or classify fallback data; agent/LLM eval tools (LangSmith, Braintrust, MCPJam) — evaluate whether an agent's tool calls and outputs are correct, not whether a shipped UI's numbers are real. No dominant open-source tool was found doing "click a value, see DOM→component→state→API→DB, flagged if it's fallback/mock" as a single product. That doesn't rule out something small, private, or very recent existing — do a final search before publishing (see §9) — but it's a reasonable gap to build into.

**Naming.** "TruthLens" collides with at least 7 existing GitHub projects and one ICML 2025 paper, all in fake-news/deepfake detection. This spec uses **GroundTrace**. Rename freely if you disagree; nothing technical below depends on it.

**Why opt-in SDK calls instead of automatic zero-config instrumentation.** The original pitch implies GroundTrace could auto-instrument *any* React app with no code changes, via AST/compiler transforms. That's a real V2 direction but a poor V1 bet: Next.js's default compiler is SWC, not Babel, and writing a correct SWC plugin (Rust) or reliably injecting a custom Babel pass across App Router server/client boundaries is a multi-week problem on its own, before any provenance logic exists. V1 instead ships a small SDK (`useTruthValue`, `withTrace`) that a developer — or a coding agent — calls explicitly around values worth tracking. It's less magical, but it's buildable in the time this spec assumes, and it still produces the full killer demo.

**Why SQLite instead of Postgres for the demo.** Real SQL, real query latency, real file I/O — genuinely "real data," not a fake — but no Docker daemon, no separate service, no port conflicts to debug in an unattended build. Postgres remains a fine adapter target later; the provenance-tracking approach doesn't care which database sits behind the query wrapper.

**Why `bippy` instead of hand-rolled fiber walking.** React doesn't expose its internal fiber tree publicly; React DevTools gets access by registering `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` before React loads, and reading fibers off it. `bippy` (npm, actively maintained, built by the React Scan author) already does this safely across React 17–19 and ships `traverseFiber`, `traverseProps`, `traverseState`. Building this from scratch would be re-solving an already-solved, actively-maintained problem.

---

## §0 — Bootstrap

**Goal:** a working monorepo skeleton with tooling, before any GroundTrace-specific code exists.

**Build notes:**
- `git init` if needed. `pnpm init` at the root.
- `pnpm-workspace.yaml` listing `packages/*` and `examples/*`.
- Root `package.json` with shared devDependencies: `typescript`, `vitest`, `eslint`, `prettier`, `@types/node`.
- `tsconfig.base.json` at root (strict mode, `target: ES2022`, `module: NodeNext`), extended by each package's own `tsconfig.json`.
- Empty package folders with a stub `package.json` + `src/index.ts` for: `packages/core`, `packages/node`, `packages/react`, `packages/cli`.
- `.gitignore` (node_modules, dist, .env, *.db).
- Root `README.md` — placeholder for now, filled in properly in §9.
- `LICENSE` — MIT, current year.

**Create `PROGRESS.md`** at repo root from this template:

```markdown
# Progress

Phase status: NOT_STARTED / IN_PROGRESS / DONE / BLOCKED

- [ ] Phase 0 — Bootstrap
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
(one line per completed phase: what was built, what the acceptance check showed)
```

**Create `DECISIONS.md`** at repo root, empty except a header: `# Decisions\n\nOne line per call made without spec guidance, newest last.`

**Acceptance criteria:**
- `pnpm install` succeeds at root with zero errors
- `pnpm -r build` runs (even if each package just builds an empty stub) with exit code 0
- `PROGRESS.md` and `DECISIONS.md` exist and match the templates above

---

## §1 — Test-claim verification (`packages/cli`, early slice)

**Goal:** the simplest possible version of "verify, don't trust the agent's claim," shippable before any of the harder provenance work exists. This is deliberately the first real feature so there's something working early.

**Build notes:** a CLI subcommand that wraps a test-runner invocation, captures real evidence, and reports pass/fail based on that evidence — not on what anything *claims*.

```ts
// packages/cli/src/commands/verify-tests.ts
import { spawnSync } from "node:child_process";

interface TestEvidence {
  command: string;
  exitCode: number;
  testsDiscovered: number | null; // parsed from output when possible
  testsPassed: number | null;
  raw: string; // last ~2000 chars of combined output, for the report
}

export function verifyTests(command: string): TestEvidence {
  const result = spawnSync(command, { shell: true, encoding: "utf-8" });
  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  return {
    command,
    exitCode: result.status ?? -1,
    testsDiscovered: parseDiscovered(combined), // simple regex per runner (pytest, vitest, jest — start with these three)
    testsPassed: parsePassed(combined),
    raw: combined.slice(-2000),
  };
}
```

Ship regex parsers for pytest (`\d+ passed`), vitest/jest (`Tests\s+\d+ passed`) output formats. If parsing fails, still report the exit code — that alone is real evidence, it just can't state a count.

Report format (this is the "TEST CLAIM" box from the original pitch — matches its wording, it's a good design):

```
TEST CLAIM
━━━━━━━━━━━━━━━━━━━━
Command:  pytest
Evidence: ✓ executed · ✓ exit code 0 · ✓ 27 discovered · ✓ 27 passed
Status:   VERIFIED
```

vs. a command that was never run or exited non-zero:

```
TEST CLAIM
━━━━━━━━━━━━━━━━━━━━
Command:  pytest
Evidence: ✓ executed · ✗ exit code 1
Status:   UNVERIFIED — 3 failures in the raw output below
```

**Deliverables:** `groundtrace verify-tests -- <command>` CLI command; unit tests using fixture output strings (not real pytest/vitest execution) for the three parsers; unit tests covering the exit-code-only fallback path.

**Acceptance criteria:**
- Running against a deliberately failing test file produces `Status: UNVERIFIED` with the real failure count
- Running against a passing suite produces `Status: VERIFIED` with a correct count
- A command that isn't a real test runner (e.g. `echo hi`) still reports honestly (exit code captured, counts `null`, no fabricated numbers)

---

## §2 — Node provenance SDK (`packages/node` → `@groundtrace/node`)

**Goal:** server-side request-scoped tracking of whether a value came from a real source or a caught failure, correlated per HTTP request using `AsyncLocalStorage` (Node's built-in mechanism for exactly this — no need for a third-party context library).

```ts
// packages/node/src/context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceEvent {
  sourceId: string;
  status: "VERIFIED" | "FALLBACK_TRIGGERED";
  detail?: string; // e.g. the error message that caused a fallback
  timestamp: number;
}

export interface TraceContext {
  traceId: string;
  events: TraceEvent[];
}

const storage = new AsyncLocalStorage<TraceContext>();

export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId, events: [] }, fn);
}

export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

export async function withTrace<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = getTraceContext();
  try {
    const result = await fn();
    ctx?.events.push({ sourceId, status: "VERIFIED", timestamp: Date.now() });
    return result;
  } catch (err) {
    ctx?.events.push({
      sourceId,
      status: "FALLBACK_TRIGGERED",
      detail: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    });
    throw err; // re-throw — the caller's own catch block decides the fallback value, and that assignment is a separate, deliberately-visible step (see the demo in §6)
  }
}
```

For Next.js API routes (Node runtime — see CLAUDE.md tech stack): call `runWithTrace(requestId, handler)` at the top of each route, then wrap the DB query with `withTrace("revenue-query", () => db.query(...))`.

**SQLite query wrapper**, thin, just for consistent instrumentation:

```ts
// packages/node/src/sqlite.ts
export function instrumentedQuery<T>(db: Database, sourceId: string, sql: string, params?: unknown[]): T {
  return withTraceSync(sourceId, () => db.prepare(sql).all(params) as T);
  // withTraceSync: same idea as withTrace above, synchronous, since better-sqlite3 is sync
}
```

**Deliverables:** `@groundtrace/node` package exporting `runWithTrace`, `withTrace`, `getTraceContext`, `instrumentedQuery`; unit tests proving context isolation across concurrent requests (two parallel `runWithTrace` calls must not leak events into each other — this is the whole point of `AsyncLocalStorage` over a global variable, so test it explicitly).

**Acceptance criteria:**
- Two concurrent simulated requests, one whose wrapped call succeeds and one whose wrapped call throws, each report only their own event, never the other's
- A `withTrace` call outside of `runWithTrace` doesn't crash — it just doesn't record anything (fail-open, not fail-crash)

---

## §3 — React provenance SDK (`packages/react` → `@groundtrace/react`)

**Goal:** let a component mark a rendered value as tracked, tag its DOM output, and capture where in the source it was called from — without a compiler plugin.

**Source-location capture, without Babel/SWC:** call `new Error().stack` inside the tracking function. In a dev build, source maps are already enabled by default (Vite, Next.js dev server), so the stack trace — when resolved through the `source-map` package, or simply read via browser DevTools, which resolves it automatically — points at the real `.tsx` file and line, not the bundled output. This sidesteps needing any custom compiler step for V1.

```ts
// packages/react/src/useTruthValue.ts
import { useEffect, useId } from "react";
import { reportNode } from "./client";

interface TruthMeta {
  id?: string;      // stable id for this value; auto-generated if omitted
  source: string;    // human label for where this value logically comes from, e.g. "/api/revenue"
}

export function useTruthValue<T>(value: T, meta: TruthMeta): T {
  const autoId = useId();
  const id = meta.id ?? autoId;
  useEffect(() => {
    reportNode({
      id,
      value,
      source: meta.source,
      callSite: new Error().stack?.split("\n")[2]?.trim() ?? "unknown",
      capturedAt: Date.now(),
    });
  }, [value, id, meta.source]);
  return value;
}
```

Usage in the demo (`§6`):

```tsx
const revenue = useTruthValue(data?.revenue, { id: "revenue", source: "/api/revenue" });
return <span data-truth-id="revenue">{formatCurrency(revenue)}</span>;
```

The `data-truth-id` attribute is what makes the element clickable in the overlay (§5) — the developer (or agent) adds it manually alongside `useTruthValue` in V1; auto-injecting it is a compiler-plugin problem, deferred to the roadmap.

`reportNode` posts to a small local endpoint the CLI's dev server exposes (see §7) — this is how client-captured events and server-captured events (§2) end up in the same place for correlation (§4).

Also ship a JSX-friendly wrapper for cases where a hook is awkward:

```tsx
// packages/react/src/Truth.tsx
export function Truth({ id, source, children }: { id: string; source: string; children: React.ReactNode }) {
  useTruthValue(children, { id, source });
  return <span data-truth-id={id}>{children}</span>;
}
```

**On `bippy` (why it's listed in the tech stack even though the sketch above doesn't need it yet):** the hook/hocverconstitutes V1's tagging mechanism and doesn't require fiber introspection. `bippy` becomes relevant the moment the overlay (§5) needs to resolve a clicked DOM node back to *which* component rendered it when `data-truth-id` alone is ambiguous (e.g. the same id rendered in a list) — use `traverseFiber` from the DOM node upward via bippy's fiber-owner APIs in that case. Keep the V1 dependency but don't over-build against it before §5 needs it.

**Deliverables:** `@groundtrace/react` exporting `useTruthValue`, `Truth`; a component test (React Testing Library + Vitest) confirming `data-truth-id` renders and `reportNode` fires with the right payload.

**Acceptance criteria:**
- Rendering `<Truth id="x" source="/api/y">42</Truth>` produces `<span data-truth-id="x">42</span>` in the DOM
- `reportNode` is called exactly once per value change, not once per render

---

## §4 — Correlation + classification (`packages/core` → `@groundtrace/core`)

**Goal:** take the raw client events (§3) and server events (§2) and produce one provenance tree per tracked value, with a classification.

```ts
// packages/core/src/classify.ts
export type ProvenanceStatus = "VERIFIED" | "INDIRECT" | "FALLBACK" | "SYNTHETIC" | "UNTRACED";

export interface ProvenanceNode {
  label: string;      // e.g. "DashboardCard.tsx:42", "/api/revenue", "orders.total"
  status: ProvenanceStatus;
  children: ProvenanceNode[];
}

// Classification rules, in order:
// 1. No SDK event exists for this DOM id at all           -> UNTRACED
// 2. A server TraceEvent for this id has status
//    FALLBACK_TRIGGERED (i.e. the withTrace()'d call threw) -> FALLBACK
// 3. No server event exists AND the value matches a value
//    present in the client bundle's source as a literal
//    (best-effort static check, not required to be perfect) -> SYNTHETIC
// 4. A server event exists with status VERIFIED, and the
//    displayed value is a direct passthrough                -> VERIFIED
// 5. Same as 4, but the value went through a named transform
//    function between the API response and the DOM           -> INDIRECT
```

Correlation key: the `id` from `useTruthValue` on the client, matched against `sourceId` from `withTrace` on the server, joined via the request's trace id (a header the client fetch call sets, e.g. `x-groundtrace-id`, generated per navigation and threaded through `runWithTrace` in §2).

**Deliverables:** `@groundtrace/core` exporting `classify(clientEvents, serverEvents): ProvenanceNode`; unit tests, one fixture per classification status, including the two the whole demo depends on: a `VERIFIED` fixture (server event succeeded, client value matches) and a `FALLBACK` fixture (server event has `FALLBACK_TRIGGERED`, client shows the fallback constant).

**Acceptance criteria:**
- Each of the 5 statuses has a passing fixture test
- Feeding it the exact event shape §2 and §3 actually produce (not just hand-written fixtures) classifies correctly — an integration test, not just unit tests against synthetic data

---

## §5 — Browser overlay

**Goal:** click a `[data-truth-id]` element in the running demo app, see its provenance tree.

**Approach:** a small injected script (served by the CLI's local dev proxy — see §7) that:
1. Listens for clicks on any `[data-truth-id]` element
2. Fetches that id's classification from the local CLI server (which holds the correlated data from §4)
3. Renders an overlay panel — not a separate browser extension, not an iframe from an external origin, just an absolutely-positioned panel injected into the page. Simpler, and avoids a whole browser-extension packaging/review process that isn't needed for a dev-mode tool.

**Visual direction (worth being deliberate about — this is the demo's money shot):** don't default to a generic dark-mode SaaS panel. Lean fully into a real terminal/debugger aesthetic — monospace type throughout, not just for code; box-drawing tree connectors (`└──`, `├──`) rendered as actual characters, matching the tree shown in the original pitch; a mostly grayscale/black panel where the five classification colors (🟢🟡🟠🔴⚪) are the *only* color in the UI and always mean the same thing everywhere they appear — status lights, not decoration. That restraint is the signature: color carries meaning, nothing else competes with it.

**Deliverables:** the injected overlay script; the local server endpoint it calls; a visible "DEV MODE — not for production" badge on the overlay itself, since this is explicitly out of scope for production use (see Non-goals in `CLAUDE.md`).

**Acceptance criteria:**
- Clicking a `VERIFIED` value shows a green-toned tree ending in the real source
- Clicking a `FALLBACK` value shows the orange-toned tree ending in the `catch` block, and the exact wording "not backed by live data" (or equivalent) appears, matching the pitch's intended punchline
- Overlay works with keyboard focus (Escape closes it) — small thing, don't skip it

---

## §6 — Reference demo (`examples/dashboard-demo`)

**Goal:** the actual killer demo. This is the phase most worth getting exactly right; everything else exists to make this work.

**Build notes:** Next.js App Router app, Node runtime. One page: a revenue dashboard.

- SQLite (`better-sqlite3`) database, seeded with an `orders` table such that `SELECT SUM(total) AS revenue, COUNT(DISTINCT customer_id) AS customers FROM orders` returns real numbers.
- `/api/revenue` route, wrapped in `runWithTrace` + `instrumentedQuery` (§2).
- An env var `SIMULATE_API_FAILURE` (**default `true`** — the demo should open on the "gotcha" state, not the healthy one, since that's the more compelling first impression) that makes the route throw before it reaches the DB.
- The route's `catch` block returns a hardcoded fallback matching the original pitch's numbers exactly, so the demo visually matches what was pitched:

```ts
const DEMO_FALLBACK = { revenue: 184293, growth: 0.248, customers: 14293 };
```

- The dashboard component uses `useTruthValue` (§3) around each of the three displayed numbers, each tagged with `data-truth-id`.
- A visible toggle in the page header — not just an env var — labeled "Simulate API failure," so a viewer (or a recorded GIF) can flip it live and watch the classification change from 🟠 `FALLBACK` to 🟢 `VERIFIED` without restarting anything.

**Acceptance criteria:**
- Fresh clone → `pnpm install && pnpm dev` inside the example → dashboard loads with no manual setup
- Default state: clicking the revenue number shows a 🟠 `FALLBACK` chain ending at the simulated failure
- Toggled state: clicking the revenue number shows a 🟢 `VERIFIED` chain ending at the real `orders.total` SQLite query, and the number on screen matches what the seeded data actually sums to
- This is the phase to actually click through yourself and confirm it feels like the pitch's mockups before marking it `DONE`

---

## §7 — CLI (`packages/cli` → `groundtrace`)

**Goal:** tie everything above together behind one command-line tool.

**Commands:**

| Command | Does |
|---|---|
| `groundtrace init` | scaffolds config into an existing Next.js project (not just the demo) |
| `groundtrace run` | starts the target app plus the local correlation server plus the overlay injection, all together |
| `groundtrace verify-tests -- <cmd>` | §1's test-claim check |
| `groundtrace verify` | runs build + tests + a quick provenance scan, prints the confidence report box (below) |
| `groundtrace report` | prints the last `verify` run's results without re-running anything |

**`verify` report format** (this is the pitch's "TRUTHLENS VERIFICATION" box):

```
GROUNDTRACE VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build            ✓
Tests            ✓  (12/12, see verify-tests log)
Tracked values   3
  Verified       2
  Fallback       1  ⚠ revenue (see: groundtrace report --id revenue)
Confidence       67%
```

Confidence = (verified + indirect) / tracked, simple and explainable — don't over-engineer a scoring model for V1.

**Deliverables:** the five commands above; an integration test that runs `groundtrace verify` against the §6 demo in both toggle states and confirms the printed confidence number changes accordingly.

**Acceptance criteria:**
- `npx groundtrace run` inside the demo app starts it and the overlay works, from a single command
- `groundtrace verify` against the demo's default (failure-simulated) state reports confidence < 100% and names `revenue` as the flagged value

---

## §8 — Claude Code hook integration

**Goal:** when GroundTrace is used *inside* a project Claude Code is working on, a `Stop` hook runs `groundtrace verify` automatically after Claude finishes a turn and surfaces the result — the "instead of Done ✅" idea from the pitch.

**Scope for V1: informational only.** Print the report; don't block Claude's turn on it. Auto-blocking Claude's own stop event on a heuristic confidence score is more likely to create annoying loops than to help in a first version — that's a reasonable V2 experiment once the confidence scoring in §7 has been used enough to trust it.

`groundtrace init --claude-code-hook` should write this into the *consuming* project's `.claude/settings.json` (create the file if absent, merge into it if hooks already exist — don't overwrite other hooks):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx groundtrace verify --quiet || true"
          }
        ]
      }
    ]
  }
}
```

`|| true` matters: a hook command that exits non-zero for an unrelated reason (e.g. `groundtrace` not installed in this particular project) shouldn't break Claude Code's normal stop flow. The report is a nice-to-have signal, not a gate, in V1.

**Deliverables:** the `--claude-code-hook` init flag; a settings-merge function that's tested against "no existing hooks file," "existing file with unrelated hooks," and "existing file that already has a Stop hook" (append to the array in that last case, don't clobber it).

**Acceptance criteria:**
- Running the flag in a project with no `.claude/` directory creates one with valid JSON
- Running it in a project that already has a `.claude/settings.json` with an unrelated `PostToolUse` hook leaves that hook intact and adds the `Stop` hook alongside it

---

## §9 — Docs + final QA

**Goal:** make the repo make sense to someone who has never seen this spec.

**README.md must include**, in this order: one-sentence pitch; the before/after screenshot or terminal-recording pair (🟠 fallback → click → provenance tree → toggle → 🟢 verified) — this is the "30-second GIF" moment from the original pitch, and it's worth actually producing, not just describing; install instructions (`npx groundtrace init`); a two-minute quickstart against the bundled demo; a short "how it works" section (one paragraph on the opt-in-SDK approach and why, referencing the research notes at the top of this file); license.

**Before marking this phase — and the whole project — done:**
- Run every acceptance criterion listed in §0–§8 again, from a genuinely fresh clone, not from the working directory you built in
- Do one fresh web search for "groundtrace" (or whatever name is actually in use) to catch a same-name collision that wasn't there when this spec was written
- Confirm the Definition of Done in `CLAUDE.md` is fully met
- Final commit, final `PROGRESS.md` update marking every phase `DONE`

---

## Roadmap (explicitly not V1 — don't build these now)

- Automatic instrumentation via a Babel/SWC compiler plugin (removes the need to manually call `useTruthValue`)
- Vue and Svelte adapters (would need their own reactivity-system-specific equivalent of `bippy`)
- Express/Fastify adapter as an alternative to Next.js
- Postgres adapter alongside SQLite
- Browser extension version of the overlay (works on any site, not just apps that imported the SDK)
- VSCode extension
- Blocking Stop-hook mode once confidence scoring has real-world track record
- Hosted/shared reports for team use
