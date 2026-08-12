# Contributing

Thanks for looking. GroundTrace is small, opinionated, and has one rule that matters more
than the rest.

## The rule

**Don't claim what you haven't verified.** This project exists because software routinely
reports success it hasn't earned, so the bar for its own claims is high:

- A test that asserts on a mock proves your mock matches your idea of a thing. Test against
  the real one where you can — the Express, Fastify, and Vue adapters are all tested against
  real servers and a real renderer, and both of the bugs they caught were shape mismatches a
  mock would have happily confirmed.
- If a check couldn't run, say so in the output. `verify` reports "not scanned" rather than a
  confidence number it can't back, and that pattern should hold anywhere else it comes up.
- If a result is inferred rather than proven, the wording has to say which. See
  `@groundtrace/auto`, where an ambiguous match is reported as ambiguous.

## Getting set up

```bash
pnpm install
pnpm build
pnpm test
```

Node 22.6+ and pnpm. `pnpm test` includes an end-to-end suite that boots the real demo twice;
`GROUNDTRACE_SKIP_E2E=1` skips it while you're iterating.

To see the thing actually work:

```bash
cd examples/dashboard-demo && pnpm dev
```

Then click a number.

## Before you open a PR

```bash
pnpm build && pnpm test && pnpm lint && pnpm format:check
```

CI runs exactly these. Please add a test that fails without your change — for a bug fix,
write it first and watch it fail.

## Where things live

| Path | |
|---|---|
| `packages/core` | Event vocabulary, classification, the collector protocol |
| `packages/node` | Server SDK and framework adapters |
| `packages/react`, `packages/vue` | Client SDKs |
| `packages/auto` | Zero-config value matching |
| `packages/overlay` | The browser panel |
| `packages/cli` | `groundtrace` |
| `packages/mcp` | MCP server |
| `examples/dashboard-demo` | The reference demo — the thing to check a change against |

`docs/BUILD_SPEC.md` and `docs/V2_SPEC.md` describe what each phase was meant to do and what
"done" meant for it. `DECISIONS.md` records every judgement call and why — if you're
wondering "why on earth is it like that", start there.

## Judgement calls

If you hit something the specs don't settle, pick the most defensible option, add a line to
`DECISIONS.md` explaining it, and carry on. A short note beats a long deliberation.

## Licence

By contributing you agree your work is licensed under the [MIT Licence](LICENSE).
