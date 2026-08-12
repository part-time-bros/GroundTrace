# @groundtrace/node

Server SDK for [GroundTrace](https://github.com/part-time-bros/groundtrace). Request-scoped
provenance tracking built on Node's `AsyncLocalStorage`, so concurrent requests never leak
events into each other.

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
      recordFallbackValue("revenue-fallback", FALLBACK, String(error));
      return FALLBACK;
    }
  },
  { route: "/api/revenue" },
);
```

`withTrace` records a failure and then **re-throws**: your own `catch` block still decides
what the fallback is. Outside a `runWithTrace` scope everything is a no-op rather than a
crash — instrumentation that breaks an un-instrumented path would be worse than useless.

Next.js App Router on the **Node runtime** (not Edge, which complicates context propagation).

MIT
