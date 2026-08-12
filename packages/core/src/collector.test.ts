import { beforeEach, describe, expect, it } from "vitest";
import { COLLECTOR_BASE, handleCollectorRequest } from "./collector.js";
import type { ProvenanceReport, ValueProvenance } from "./events.js";
import { EventStore } from "./store.js";

let store: EventStore;

beforeEach(() => {
  store = new EventStore();
});

const NODE = {
  id: "revenue",
  value: 91_400,
  source: "/api/revenue",
  traceId: "gt_1",
  capturedAt: 1_000,
};

const TRACE = {
  traceId: "gt_1",
  route: "/api/revenue",
  startedAt: 900,
  events: [
    {
      sourceId: "revenue-query",
      status: "VERIFIED" as const,
      timestamp: 940,
      produces: ["revenue"],
      values: { revenue: 91_400 },
    },
  ],
};

describe("routing", () => {
  it("accepts paths with or without the /__groundtrace prefix", () => {
    for (const path of [
      "/health",
      `${COLLECTOR_BASE}/health`,
      `${COLLECTOR_BASE}/health/`,
    ]) {
      expect(handleCollectorRequest(store, { method: "GET", path }).status).toBe(200);
    }
  });

  it("404s an unknown route instead of guessing", () => {
    const response = handleCollectorRequest(store, { method: "GET", path: "/nope" });
    expect(response.status).toBe(404);
  });

  it("404s a known route used with the wrong method", () => {
    const response = handleCollectorRequest(store, { method: "GET", path: "/nodes" });
    expect(response.status).toBe(404);
  });
});

describe("ingest", () => {
  it("accepts a batch of client nodes", () => {
    const response = handleCollectorRequest(store, {
      method: "POST",
      path: "/nodes",
      body: [NODE, { ...NODE, id: "customers", value: 128 }],
    });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: 2, rejected: 0 });
    expect(store.size.nodes).toBe(2);
  });

  it("accepts a single node that wasn't wrapped in an array", () => {
    handleCollectorRequest(store, { method: "POST", path: "/nodes", body: NODE });
    expect(store.node("revenue")?.value).toBe(91_400);
  });

  it("rejects malformed events instead of storing them", () => {
    const response = handleCollectorRequest(store, {
      method: "POST",
      path: "/nodes",
      body: [NODE, { nonsense: true }, null],
    });
    expect(response.body).toEqual({ accepted: 1, rejected: 2 });
    expect(store.size.nodes).toBe(1);
  });

  it("accepts server traces", () => {
    const response = handleCollectorRequest(store, {
      method: "POST",
      path: "/traces",
      body: TRACE,
    });
    expect(response.status).toBe(202);
    expect(store.trace("gt_1")?.events).toHaveLength(1);
  });
});

describe("read endpoints", () => {
  beforeEach(() => {
    handleCollectorRequest(store, { method: "POST", path: "/nodes", body: NODE });
    handleCollectorRequest(store, { method: "POST", path: "/traces", body: TRACE });
  });

  it("classifies one value on demand", () => {
    const response = handleCollectorRequest(store, {
      method: "GET",
      path: "/value",
      query: { id: "revenue" },
    });
    expect(response.status).toBe(200);
    expect((response.body as ValueProvenance).status).toBe("VERIFIED");
  });

  it("400s a /value call with no id", () => {
    const response = handleCollectorRequest(store, { method: "GET", path: "/value" });
    expect(response.status).toBe(400);
  });

  it("builds the whole report", () => {
    const response = handleCollectorRequest(store, { method: "GET", path: "/report" });
    const report = response.body as ProvenanceReport;
    expect(report.tracked).toBe(1);
    expect(report.confidence).toBe(1);
  });

  it("counts ids seen in the DOM but never reported as UNTRACED", () => {
    const response = handleCollectorRequest(
      store,
      { method: "GET", path: "/report" },
      { knownIds: ["revenue", "growth"] },
    );
    const report = response.body as ProvenanceReport;
    expect(report.tracked).toBe(2);
    expect(report.counts.UNTRACED).toBe(1);
    expect(report.confidence).toBe(0.5);
  });

  it("hands back the raw snapshot for debugging", () => {
    const response = handleCollectorRequest(store, { method: "GET", path: "/events" });
    expect(response.body).toEqual(store.snapshot());
  });

  it("clears everything on request", () => {
    expect(
      handleCollectorRequest(store, { method: "DELETE", path: "/events" }).status,
    ).toBe(200);
    expect(store.size).toEqual({ nodes: 0, traces: 0 });
  });
});

describe("EventStore", () => {
  it("keeps only the latest event per id", () => {
    store.recordNode({ ...NODE, value: 1, capturedAt: 1 });
    store.recordNode({ ...NODE, value: 2, capturedAt: 2 });
    expect(store.size.nodes).toBe(1);
    expect(store.node("revenue")?.value).toBe(2);
  });

  it("merges events into an existing trace rather than replacing it", () => {
    store.recordTrace(TRACE);
    store.recordTrace({
      ...TRACE,
      events: [{ sourceId: "second", status: "VERIFIED", timestamp: 999 }],
    });
    expect(store.trace("gt_1")?.events).toHaveLength(2);
  });

  it("evicts the oldest entries once full", () => {
    const small = new EventStore({ maxNodes: 2, maxTraces: 1 });
    small.recordNode({ ...NODE, id: "a" });
    small.recordNode({ ...NODE, id: "b" });
    small.recordNode({ ...NODE, id: "c" });
    expect(small.size.nodes).toBe(2);
    expect(small.node("a")).toBeUndefined();
    expect(small.node("c")).toBeDefined();
  });
});
