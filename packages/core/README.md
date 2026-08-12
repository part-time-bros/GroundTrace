# @groundtrace/core

Correlation and classification for [GroundTrace](https://github.com/part-time-bros/groundtrace).

Takes the raw client events (`@groundtrace/react`) and server traces (`@groundtrace/node`),
joins them on a trace id, and produces one provenance tree per displayed value with a
classification: `VERIFIED`, `INDIRECT`, `FALLBACK`, `SYNTHETIC`, or `UNTRACED`.

```ts
import { buildReport, classifyValue, renderTree } from "@groundtrace/core";

const value = classifyValue("revenue", { nodes, traces });
console.log(value.status); // "FALLBACK"
console.log(value.reason); // "revenue-query" failed … not backed by live data
console.log(renderTree(value.tree).join("\n"));
```

Also exports `EventStore` and `handleCollectorRequest` — a transport-agnostic collector the
CLI mounts on `node:http` and the demo mounts on a Next route handler.

MIT
