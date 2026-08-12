# @groundtrace/react

React SDK for [GroundTrace](https://github.com/part-time-bros/groundtrace). Marks a rendered
value as tracked, tags its DOM node, and captures where in your source it was rendered from —
without a compiler plugin.

```tsx
import { TraceScope, useTracedQuery, useTruthValue } from "@groundtrace/react";

const { data, traceId } = useTracedQuery<Payload>("/api/revenue");

<TraceScope traceId={traceId}>
  <Metric />
</TraceScope>;

function Metric() {
  const revenue = useTruthValue(data?.revenue, { id: "revenue", source: "/api/revenue" });
  return <span data-truth-id="revenue">{formatCurrency(revenue)}</span>;
}
```

`<Truth id="x" source="/api/y">42</Truth>` does both steps at once when a hook is awkward.

Values are reported once per *change*, not once per render — including when the tracked value
is a fresh object identity each time. Declaring `transform: "toPercent"` is what separates
🟡 `INDIRECT` from 🟢 `VERIFIED`.

MIT
