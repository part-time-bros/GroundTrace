# @groundtrace/vue

The Vue SDK for [GroundTrace](https://github.com/part-time-bros/groundtrace).

```ts
import { useTruthValue, tracedFetchJson } from "@groundtrace/vue";

const { data, traceId } = await tracedFetchJson("/api/revenue");

useTruthValue(() => data.revenue, {
  id: "revenue",
  source: "/api/revenue",
  traceId,
});
```

```vue
<Truth id="revenue" source="/api/revenue" :value="data.revenue">
  {{ formatCurrency(data.revenue) }}
</Truth>
```

Takes a ref, a getter, or a plain value, and reports on change rather than on every render —
Vue's `watch` gives that directly, where the React SDK needed a structural key for the same
guarantee.

It emits the same `ClientNodeEvent` shape as `@groundtrace/react` and posts to the same
collector, so the overlay and the CLI work against a Vue app unchanged. That portability was
the test: adding this package required no changes to `@groundtrace/core`.

MIT
