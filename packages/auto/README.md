# @groundtrace/auto

Zero-config [GroundTrace](https://github.com/part-time-bros/groundtrace): tracks displayed
values with **no `useTruthValue` calls anywhere in your app**.

```ts
import { startAutoTagging } from "@groundtrace/auto";

startAutoTagging();
```

Instrumented server code already records the values each source produced. If a number on the
page equals one of them, the page is very probably showing that source's output — so the
tagger adds the `data-truth-id` for you and the overlay works as normal.

"Very probably" is doing real work in that sentence, and the package keeps it honest:

- An auto-matched value's reason says **"matched automatically, not declared"**. It is
  evidence, not proof.
- When two tracked values share a number, the match is **ambiguous**. On a healthy source
  that is reported `UNTRACED` — which source fed this element genuinely cannot be
  determined — rather than guessed. On a *failed* source it still reports `FALLBACK`,
  because a possible fallback is the case worth surfacing.
- An explicit `data-truth-id` is never overwritten. A declaration always outranks an
  inference.

It matches on the DOM, not React's fiber tree, so it works the same for React, Vue, Svelte,
and server-rendered HTML.

Use it to find out whether a codebase has a problem; use `@groundtrace/react` where you want
proof.

MIT
