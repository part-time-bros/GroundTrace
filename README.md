# GroundTrace

**Click a number on your page and see exactly where it came from — including when it quietly came from a `catch` block instead of your API.**

[![CI](https://github.com/part-time-bros/GroundTrace/actions/workflows/ci.yml/badge.svg)](https://github.com/part-time-bros/GroundTrace/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node: >=22.6](https://img.shields.io/badge/node-%3E%3D22.6-brightgreen.svg)](package.json)
[![tests: 294](https://img.shields.io/badge/tests-311%20passing-brightgreen.svg)](#development)

---

## The 30-second version

Here is a revenue dashboard. It builds cleanly, it renders, its tests pass. Every number on
it is fabricated, and nothing on screen says so.

Click the number, and GroundTrace traces it back through **component → state → API →
database**:

![A dashboard showing $184,293. The GroundTrace overlay traces it to a catch block: "this value is not backed by live data".](docs/media/fallback.png)

> `revenue = 184293` · 🟠 **FALLBACK** — the API threw, a `catch` block substituted a
> hardcoded constant, and the dashboard rendered it without comment.

Now flip **Simulate API failure** off and click the same number again:

![The same dashboard showing $96,159. The overlay traces it to the real SQL query and reports VERIFIED.](docs/media/verified.png)

> `revenue = 96159` · 🟢 **VERIFIED** — traced to the real `SELECT SUM(total) …` against
> SQLite, and the number on screen is provably the number the query returned.

Same page. Same click. The only thing that changed is whether the data was real — which is
exactly the thing you could not see before.

---

## Why this exists

Coding agents (Claude Code included) can produce a UI that looks finished — it builds, it
renders, "tests pass ✅" — while a failed request quietly fell back to mock data
underneath. Every signal you normally trust stays green, because none of them are looking at
whether the numbers are real.

GroundTrace makes that gap visible. Every tracked value gets one of five classifications,
and the same status lights mean the same thing in the browser, in the terminal, and in the
docs:

| | Status | Meaning |
|---|---|---|
| 🟢 | `VERIFIED` | A real source succeeded and the displayed value matches what it returned |
| 🟡 | `INDIRECT` | Real source, but the value passed through a named transform on the way to the DOM |
| 🟠 | `FALLBACK` | The source failed — this value came out of a `catch` block |
| 🔴 | `SYNTHETIC` | No source produced it, and its value appears as a literal in your source |
| ⚪ | `UNTRACED` | Displayed, but nothing reported it — GroundTrace has no evidence either way |

The verdicts are auditable, not vibes: every value carries a plain-English `reason`
explaining which rule fired and on what evidence, right down to whether a `VERIFIED`
passthrough was *proven* against a recorded source value or merely assumed.

---

## For agents

GroundTrace ships as MCP tools, so an agent can check its own work *before* it says
"Done ✅" rather than leaving you to find out later:

| Tool | Does |
|---|---|
| `verify_app` | Builds, tests, and traces the app; returns the confidence report |
| `list_tracked_values` | Every tracked value with its status and reasoning |
| `explain_value` | One value's full component → state → API → database chain |
| `verify_tests` | Runs a test command and reports the real evidence |
| `last_report` | The saved report, without re-running anything |

With no saved report, the read-only tools return an *error* telling the agent to run
`verify_app` first — never an empty result it could mistake for a pass.

For CI, `groundtrace verify --fail-under 95 --json` gates the build on the same number, and
`--block` emits Claude Code hook JSON that stops a turn when values aren't backed by real
sources.

---

## Install

> [!IMPORTANT]
> **Not published to npm yet.** `groundtrace` and the `@groundtrace/*` scope are unregistered,
> so `npx groundtrace` and `npm install @groundtrace/node` will not work today. Use it from a
> clone — every command below works that way, and the quickstart is built around it. The npm
> instructions land with the first release.

```bash
git clone https://github.com/part-time-bros/GroundTrace
cd GroundTrace
pnpm install
pnpm build
```

That gives you a working `node packages/cli/dist/bin.js` — referred to below as
`groundtrace`. To use the SDKs in another project on the same machine, link them:

```bash
pnpm --dir /path/to/your-app link /path/to/GroundTrace/packages/node
pnpm --dir /path/to/your-app link /path/to/GroundTrace/packages/react
```

Then scaffold config into it:

```bash
node /path/to/GroundTrace/packages/cli/dist/bin.js init --mcp --claude-code-hook
```

`--mcp` registers the MCP server in `.mcp.json`; `--claude-code-hook` adds a `Stop` hook that
prints a confidence report when Claude finishes a task. Both merge into existing files
without touching anything they didn't add.

---

## Two-minute quickstart

From the clone above:

```bash
cd examples/dashboard-demo
pnpm dev            # http://localhost:3000
```

Then:

1. The dashboard opens showing **$184,293**. Click it → 🟠 `FALLBACK`.
2. Untick **Simulate API failure**. The figure changes to **$96,159**.
3. Click it again → 🟢 `VERIFIED`, ending at the real SQL query.
4. Click **+18.1%** → 🟡 `INDIRECT`, because it went through `toPercent()`.
5. Press <kbd>Alt</kbd>+<kbd>G</kbd> for every tracked value on the page at once.
6. Press <kbd>Esc</kbd> to close.

Then open [http://localhost:3000/server](http://localhost:3000/server) — same dashboard, no API
route, queried inside a server component. The trace works the same.

From the terminal, without a browser:

```bash
node packages/cli/dist/bin.js verify --cwd examples/dashboard-demo --skip-build --skip-tests
```

```
GROUNDTRACE VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build            ? skipped
Tests            ? skipped
Tracked values   3
  Fallback     3  ⚠ customers, growth, revenue
Confidence       0%
```

…and with the failure switched off, the same command reports `Confidence 100%`.

---

## Using it in your own app

Three additions, all opt-in. Nothing else about your code changes.

**1. Wrap the route handler** (`@groundtrace/node`):

```ts
import { instrumentedGet, recordFallbackValue, traceRoute } from "@groundtrace/node";

export const GET = traceRoute(
  () => {
    try {
      return instrumentedGet(db, "revenue-query", "SELECT SUM(total) AS revenue FROM orders", [], {
        produces: ["revenue"],
        extract: (row) => row as Record<string, unknown>,
      });
    } catch (error) {
      recordFallbackValue("revenue-fallback", DEMO_FALLBACK, String(error));
      return DEMO_FALLBACK;
    }
  },
  { route: "/api/revenue" },
);
```

**2. Mark the displayed value** (`@groundtrace/react`):

```tsx
const revenue = useTruthValue(data?.revenue, { id: "revenue", source: "/api/revenue" });
return <span data-truth-id="revenue">{formatCurrency(revenue)}</span>;
```

**3. Run it** — app, correlation server, and overlay from one command:

```bash
node /path/to/GroundTrace/packages/cli/dist/bin.js run
```

### Commands

| Command | Does |
|---|---|
| `groundtrace init` | Scaffolds config; `--mcp` and `--claude-code-hook` wire up Claude Code |
| `groundtrace run` | Starts the app + collector + overlay injection together |
| `groundtrace verify-tests -- <cmd>` | Runs a test command and reports the real evidence |
| `groundtrace verify` | Build + tests + provenance scan as one confidence report |
| `groundtrace report` | Prints the last `verify` run; `--id revenue` for one value's tree |
| `groundtrace-mcp` | The MCP server, over stdio |

`verify` loads your app in a real browser when Playwright is available, so it can *prove* the
displayed number matches its source. Without one it verifies the server side only — and says
so, rather than printing a confidence figure it cannot back.

### Beyond Next.js and React

| | |
|---|---|
| **Server Components** | `traceServerRender` — for pages that query the database during render, with no API route at all |
| **Express / Fastify** | `app.use(groundtraceMiddleware())` · `app.register(groundtraceFastify)` |
| **Postgres** | `instrumentedQueryAsync` / `instrumentedGetAsync`, same shape as the SQLite pair |
| **Vue** | `@groundtrace/vue` — same events, same overlay, same CLI |
| **Multiple services** | `tracedFetch` propagates the trace id, so a call chain lands in one trace |
| **No instrumentation at all** | `@groundtrace/auto` matches displayed numbers against traced sources and tags them for you |

The demo ships both shapes: `/` fetches an API route from the client, `/server` queries SQLite
directly inside a server component. Clicking a number behaves identically on either.

### Production

V1 was dev-only by design. V2 makes that a setting rather than an assumption: production mode
is **off unless explicitly enabled**, samples deterministically per trace id, and redacts
recorded values to a type, a magnitude bucket, and a digest. The classifier still works on
those — "this came out of a catch block" survives redaction; the customer's revenue figure
never leaves the process.

```bash
GROUNDTRACE_MODE=production GROUNDTRACE_SAMPLE_RATE=0.05 node server.js
```

---

## How it works

GroundTrace collects two streams of raw observation and joins them on a trace id that rides
along in an `x-groundtrace-id` header:

- **Server side**, `runWithTrace` opens a request-scoped context using Node's built-in
  `AsyncLocalStorage`, and `withTrace` records whether each wrapped call succeeded or threw.
  A failed call is recorded and then **re-thrown** — your own `catch` block still decides
  what the fallback is, which keeps that decision a visible, separate step.
- **Client side**, `useTruthValue` reports each displayed value with its call site, captured
  from `new Error().stack` during render. In a dev build source maps are already on, so the
  frame resolves to your real `.tsx` file.
- **`@groundtrace/core`** stitches the two together into one provenance tree per value and
  classifies it.

**Why an opt-in SDK rather than automatic instrumentation.** The obvious pitch is to
auto-instrument any React app with zero code changes via compiler transforms. That is a real
direction, but a poor first bet: Next.js's default compiler is SWC, and writing a correct
SWC plugin (in Rust) — or reliably injecting a Babel pass across App Router server/client
boundaries — is a multi-week problem *before* any provenance logic exists. V1 ships a small
SDK you call explicitly around values worth tracking. Less magical, buildable, and it still
produces the whole demo above. The full reasoning, including the prior-art survey that found
no existing tool doing per-value provenance with fallback classification, is in
[`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md).

**This is a dev-mode tool.** The overlay says so on screen. There is no production-safe
mode, no hosted dashboard, and no accounts — see the non-goals in
[`CLAUDE.md`](CLAUDE.md) and the roadmap at the end of the build spec.

---

## Packages

| Package | What it is |
|---|---|
| [`groundtrace`](packages/cli) | The CLI — `init`, `run`, `verify-tests`, `verify`, `report` |
| [`@groundtrace/core`](packages/core) | Correlation, classification, the collector protocol |
| [`@groundtrace/node`](packages/node) | Server SDK — request-scoped tracing, DB/fetch wrappers |
| [`@groundtrace/react`](packages/react) | React SDK — `useTruthValue`, `<Truth>`, `<TraceScope>` |
| [`@groundtrace/overlay`](packages/overlay) | The browser overlay, as a module and a standalone bundle |
| [`@groundtrace/vue`](packages/vue) | Vue SDK — `useTruthValue` composable, `<Truth>` |
| [`@groundtrace/auto`](packages/auto) | Zero-config tagging, no SDK calls required |
| [`@groundtrace/mcp`](packages/mcp) | MCP server — provenance as agent-callable tools |

## Development

```bash
pnpm install
pnpm build
pnpm test        # 311 tests
pnpm lint
```

`pnpm test` includes an end-to-end check that boots the real demo and runs `groundtrace
verify` against both toggle states, plus adapter tests against real Express, Fastify, and Vue.
Set `GROUNDTRACE_SKIP_E2E=1` to skip the slow demo run.

The build is specified in [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md) (V1) and
[`docs/V2_SPEC.md`](docs/V2_SPEC.md) (V2); every judgement call made along the way is logged
in [`DECISIONS.md`](DECISIONS.md).

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). It has one rule that matters
more than the rest: **don't claim what you haven't verified.** Both bugs the adapter work
caught were shape mismatches a mock would have confirmed happily, so tests here run against
real servers and real renderers wherever that's possible.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md) — including what GroundTrace records and when
- [`DECISIONS.md`](DECISIONS.md) — every judgement call, and why

## License

MIT — see [LICENSE](LICENSE).
