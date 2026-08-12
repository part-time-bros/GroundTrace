# GroundTrace — V2 Build Spec

Successor to `docs/BUILD_SPEC.md`, which shipped V1 (§0–§9). That file's roadmap section
lists what was deliberately deferred; this file decides which of it to build, in what order,
and why — plus the items that weren't on the roadmap at all but turned out to matter more
than some that were.

---

## Research notes — what changed, and what that means

**A compiler plugin is now a *worse* bet than it was in V1, not a better one.** BUILD_SPEC
deferred automatic instrumentation on the grounds that an SWC plugin is a multi-week Rust
problem. Since then the ground has shifted further: `@vitejs/plugin-react` v6 dropped Babel
for oxc, and React Compiler 1.0 went stable — so the Babel escape hatch that made a plugin
tractable for Vite users is closing too, while Next remains on SWC/Turbopack. Writing a
Babel plugin in 2026 would target a shrinking slice of the ecosystem.

The runtime alternative got *better* over the same period. `bippy` already gives safe fiber
access across React 17–19, and V1 proved it works by using it to name the component behind a
clicked value. Walking the committed fiber tree and matching rendered values against the
values a traced source recorded is framework-native, needs no build step at all, and works
identically under Turbopack, Vite, oxc, and webpack. **§14 takes the runtime path.** That is
a reversal of the spec's stated V2 direction, and it is deliberate.

**MCP became the way tools talk to agents.** Model Context Protocol is mature infrastructure
in 2026 — protocol revision `2026-07-28`, an official Inspector, a large server ecosystem.
GroundTrace's entire thesis is "don't trust the agent's 'Done ✅'", and V1 delivered that as
a terminal report a human reads. An MCP server makes it something *the agent itself can
query mid-task*: it can check whether the number it just wired up is real before claiming it
finished. This was not on the V1 roadmap and is the single highest-leverage addition in V2.

**V1's own biggest weakness was not on the roadmap either.** `groundtrace verify` runs
headless, so it has no DOM to read; it reconstructs the client half from what the server
declared it `produces` and marks every value `valueObserved: false`. That is honest, but it
means `verify` can never prove the *displayed* number matches the source — the exact claim
the overlay makes. §10 fixes it by driving a real browser.

**Prior art, re-checked.** No npm registration for `groundtrace` or the `@groundtrace/*`
scope, and no same-name project of note. The V1 finding still holds: distributed tracing
propagates context but has no concept of "is this displayed value real"; session-capture
tools collect evidence without building per-value provenance; agent-eval tools judge tool
calls rather than shipped UI.

---

## Phase index

| # | Phase | Ships | Why it earned a slot |
|---|-------|-------|---------------------|
| 10 | Real DOM scan | `verify` drives a real browser | Closes V1's one structural dishonesty |
| 11 | MCP server | `groundtrace mcp` | Agents can self-check before saying "done" |
| 12 | Express/Fastify | adapters in `@groundtrace/node` | V1 was Next-only |
| 13 | Postgres | async query wrappers | V1 was SQLite-only |
| 14 | Auto-instrumentation | `@groundtrace/auto` | The headline roadmap item, via runtime not compiler |
| 15 | Production-safe mode | sampling, redaction, off-by-default | V1's loudest non-goal, now defensible |
| 16 | CI + blocking hook | `--json`, `--fail-under`, Action, `--block` | Makes the score enforceable |
| 17 | Vue adapter | `@groundtrace/vue` | Reach beyond React |
| 18 | Docs + QA | V2 docs, fresh-clone verification | Same bar as §9 |

Deliberately **still** not built: VSCode extension (high effort, the overlay already covers
the need), browser extension (`groundtrace run` injects into any app already), hosted
dashboard or accounts (against the project's stated shape), Svelte adapter (Vue first proves
the multi-framework pattern; Svelte follows the same shape if it's wanted).

---

## §10 — Real DOM scan in `verify`

**Goal:** `verify` should read the numbers actually on screen, not infer them.

**Build notes:** Playwright as an **optional** dependency, resolved at runtime. When it is
absent, `verify` keeps V1's reconstruction and says so; when present, it loads each
configured route, waits for the collector handshake, reads every `[data-truth-id]` element's
value from the live collector, and classifies with `valueObserved: true`.

The distinction has to survive into the report: a run that proved passthrough against real
DOM values is stronger evidence than one that verified only the server side, and the output
must say which happened.

**Acceptance criteria:**
- With Playwright installed, `verify` against the demo's healthy state reports values as
  proven passthroughs, not "server side only"
- With Playwright absent, `verify` still runs and reports the weaker basis honestly
- The demo's failure state still reports `FALLBACK` and confidence 0% under both modes

---

## §11 — MCP server (`groundtrace mcp`)

**Goal:** let an agent ask "is what I just built actually real?" as a tool call.

**Tools:**

| Tool | Does |
|---|---|
| `verify_app` | Runs the full verify pipeline, returns the structured report |
| `list_tracked_values` | Every tracked value with its status and reason |
| `explain_value` | One value's full provenance tree, rendered |
| `verify_tests` | Runs a test command, returns real evidence (not the claim) |
| `last_report` | The saved report, without re-running anything |

**Build notes:** stdio transport via `@modelcontextprotocol/sdk`. Tool results must carry the
same `reason` strings the CLI prints — an agent reading "confidence 67%" with no explanation
is exactly the opacity this project exists to remove.

**Acceptance criteria:**
- The server starts over stdio and lists its tools
- `verify_app` against the demo's failure state returns `FALLBACK` for `revenue`
- Every tool returns structured content, and errors are returned as tool errors rather than
  crashing the server

---

## §12 — Express/Fastify adapters

**Goal:** stop being Next-only.

**Build notes:** `@groundtrace/node` gains connect-style middleware (Express 5), a Fastify 5
plugin, and a bare `node:http` wrapper. All typed structurally — no framework goes into
`dependencies`. Each opens a trace from the incoming `x-groundtrace-id`, echoes it back, and
reports on response finish.

**Acceptance criteria:**
- A real Express app with the middleware produces the same `ServerTrace` shape as `traceRoute`
- A real Fastify app does too
- Both echo the trace id back and survive a handler that throws

---

## §13 — Postgres adapter

**Goal:** the provenance approach never cared which database sits behind the wrapper; prove it.

**Build notes:** `instrumentedQueryAsync` / `instrumentedGetAsync` typed against the `pg`
client shape (`query(text, values) => Promise<{ rows }>`). Structural, so `pg`, `postgres.js`
wrappers, and connection pools all satisfy it.

**Acceptance criteria:**
- A fake `pg`-shaped client records `VERIFIED` with the row values extracted
- A rejected query records `FALLBACK_TRIGGERED` and re-throws
- Works under concurrency without leaking between requests

---

## §14 — Automatic instrumentation (`@groundtrace/auto`)

**Goal:** the original pitch's promise — track values with **no** `useTruthValue` calls.

**Build notes:** after each React commit, walk the fiber tree with `bippy`. For every host
text node, take its rendered value and look for a traced source that recorded that exact
value. On a match, tag the DOM node with `data-truth-id` and report a client event whose
`auto: true` flag records that the correlation was inferred rather than declared.

This is a *heuristic*, and the classification has to say so: an auto-tagged value is
evidence that a source produced this number, not proof that this element is downstream of
that source. Two different metrics that happen to hold the same number are ambiguous, and
the report must not pretend otherwise.

**Acceptance criteria:**
- A component with zero GroundTrace calls gets its values tagged and classified
- An ambiguous match (same value rendered twice) is reported as ambiguous, not guessed
- Auto-tagging never overwrites an explicit `data-truth-id`

---

## §15 — Production-safe mode

**Goal:** V1 said "dev-mode only" and meant it. Make the restriction a setting rather than
an assumption, without turning a debugger into a data-exfiltration path.

**Build notes:** a `mode` on both SDKs — `"dev"` (today's behaviour), `"production"`
(off unless explicitly enabled; sampling rate; values redacted to type/shape/hash rather
than contents; hard caps on payload size; overlay never auto-mounts), and `"off"`.

Redaction is the important part: a fallback's *existence* is the signal worth shipping, not
the customer's revenue figure.

**Acceptance criteria:**
- Production mode records nothing unless explicitly enabled
- When enabled, recorded values are redacted and classification still works
- Sampling at 0 records nothing; at 1 records everything; deterministic per trace id

---

## §16 — CI integration and the blocking Stop hook

**Goal:** make the confidence score enforceable now that §10 gives it a real basis.

**Build notes:** `verify --json` for machine consumption, `--fail-under <percent>` for a
threshold gate, a reusable GitHub Action, and `groundtrace verify --block` which emits the
Claude Code hook JSON that actually blocks a stop. BUILD_SPEC §8 deferred blocking until the
score had a track record — §10 is what gives it one, and it stays opt-in.

**Acceptance criteria:**
- `--fail-under 100` fails on the demo's failure state and passes on the healthy one
- `--json` emits a parseable report and nothing else on stdout
- `--block` emits valid Claude Code hook JSON only when the threshold is missed

---

## §17 — Vue adapter

**Goal:** prove the SDK shape ports to another reactivity system.

**Build notes:** `@groundtrace/vue` — a `useTruthValue` composable over `watchEffect`, a
`Truth` component, and the same traced-fetch helper. Shares `@groundtrace/core`'s vocabulary
and the same collector, so the overlay and CLI work unchanged.

**Acceptance criteria:**
- A rendered Vue component reports the same `ClientNodeEvent` shape as React's
- Reports once per value change, not once per render
- The existing overlay classifies a Vue app's values with no changes

---

## §18 — Docs + final QA

Same bar as §9: README updated for every new capability, a README per new package,
`PROGRESS.md` and `DECISIONS.md` current, and the whole thing verified from a genuinely
fresh clone — `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`.
