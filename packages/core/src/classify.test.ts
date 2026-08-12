import { describe, expect, it } from "vitest";
import {
  buildReport,
  classify,
  classifyValue,
  deepEqual,
  formatValue,
} from "./classify.js";
import type { ClientNodeEvent, EventSnapshot, ServerTrace } from "./events.js";
import { renderTree } from "./render.js";

const TRACE_ID = "gt_trace-1";

function clientEvent(overrides: Partial<ClientNodeEvent> = {}): ClientNodeEvent {
  return {
    id: "revenue",
    value: 91_400,
    source: "/api/revenue",
    traceId: TRACE_ID,
    callSite: "DashboardCard (DashboardCard.tsx:42)",
    capturedAt: 1_000,
    ...overrides,
  };
}

function trace(events: ServerTrace["events"]): ServerTrace {
  return {
    traceId: TRACE_ID,
    route: "/api/revenue",
    startedAt: 900,
    endedAt: 950,
    events,
  };
}

const VERIFIED_TRACE = trace([
  {
    sourceId: "revenue-query",
    status: "VERIFIED",
    timestamp: 940,
    kind: "db",
    label: "SELECT SUM(total) AS revenue FROM orders",
    produces: ["revenue", "customers"],
    values: { revenue: 91_400, customers: 128 },
  },
]);

const FALLBACK_TRACE = trace([
  {
    sourceId: "revenue-query",
    status: "FALLBACK_TRIGGERED",
    timestamp: 940,
    kind: "db",
    label: "SELECT SUM(total) AS revenue FROM orders",
    produces: ["revenue", "customers"],
    detail: "simulated API failure",
  },
]);

function snapshot(nodes: ClientNodeEvent[], traces: ServerTrace[]): EventSnapshot {
  return { nodes, traces };
}

describe("§4 rule 1 — UNTRACED", () => {
  it("classifies an id nothing ever reported", () => {
    const result = classifyValue("mystery", snapshot([], []));
    expect(result.status).toBe("UNTRACED");
    expect(result.reason).toContain("displayed but not tracked");
  });

  it("classifies a client value no server source claimed", () => {
    const result = classifyValue("revenue", snapshot([clientEvent()], [trace([])]));
    expect(result.status).toBe("UNTRACED");
    expect(result.reason).toContain("no server source");
  });

  it("says so plainly when the value arrived without a trace id", () => {
    const result = classifyValue(
      "revenue",
      snapshot([clientEvent({ traceId: undefined })], []),
    );
    expect(result.status).toBe("UNTRACED");
    expect(result.reason).toContain("without a trace id");
  });
});

describe("§4 rule 2 — FALLBACK", () => {
  it("classifies a value whose source threw", () => {
    const result = classifyValue(
      "revenue",
      snapshot([clientEvent({ value: 184_293 })], [FALLBACK_TRACE]),
    );
    expect(result.status).toBe("FALLBACK");
    expect(result.reason).toContain("simulated API failure");
    expect(result.reason).toContain("not backed by live data");
  });

  it("outranks a healthy source in the same trace", () => {
    const mixed = trace([
      ...VERIFIED_TRACE.events,
      ...FALLBACK_TRACE.events.map((event) => ({ ...event, sourceId: "revenue-retry" })),
    ]);
    const result = classifyValue("revenue", snapshot([clientEvent()], [mixed]));
    expect(result.status).toBe("FALLBACK");
  });

  it("ends the tree at the failure, with the error as its detail", () => {
    const result = classifyValue(
      "revenue",
      snapshot([clientEvent({ value: 184_293 })], [FALLBACK_TRACE]),
    );
    const rendered = renderTree(result.tree).join("\n");
    expect(rendered).toContain("🟠");
    expect(rendered).toContain("SELECT SUM(total) AS revenue FROM orders");
    expect(rendered).toContain("simulated API failure");
  });
});

describe("§4 rule 3 — SYNTHETIC", () => {
  it("flags a value with no server source that appears as a source literal", () => {
    const result = classifyValue(
      "revenue",
      snapshot([clientEvent({ value: 184_293, traceId: undefined })], []),
      { knownLiterals: [184_293] },
    );
    expect(result.status).toBe("SYNTHETIC");
    expect(result.reason).toContain("literal");
  });

  it("does not downgrade a value that has real evidence behind it", () => {
    const result = classifyValue(
      "revenue",
      snapshot([clientEvent({ value: 91_400 })], [VERIFIED_TRACE]),
      { knownLiterals: [91_400] },
    );
    expect(result.status).toBe("VERIFIED");
  });
});

describe("§4 rule 4 — VERIFIED", () => {
  it("classifies a proven passthrough", () => {
    const result = classifyValue("revenue", snapshot([clientEvent()], [VERIFIED_TRACE]));
    expect(result.status).toBe("VERIFIED");
    expect(result.reason).toContain("matches what it returned");
  });

  it("says the match is assumed when the source recorded no value", () => {
    const noValues = trace([
      {
        sourceId: "revenue-query",
        status: "VERIFIED",
        timestamp: 940,
        produces: ["revenue"],
      },
    ]);
    const result = classifyValue("revenue", snapshot([clientEvent()], [noValues]));
    expect(result.status).toBe("VERIFIED");
    expect(result.reason).toContain("assumed");
  });

  it("keeps the real query at the bottom of the tree", () => {
    const result = classifyValue("revenue", snapshot([clientEvent()], [VERIFIED_TRACE]));
    const rendered = renderTree(result.tree).join("\n");
    expect(rendered).toContain("🟢");
    expect(rendered).toContain("DashboardCard.tsx:42");
    expect(rendered).toContain("SELECT SUM(total) AS revenue FROM orders");
  });
});

describe("§4 rule 5 — INDIRECT", () => {
  it("classifies a value that went through a named transform", () => {
    const result = classifyValue(
      "revenue",
      snapshot([clientEvent({ transform: "toDisplayCurrency" })], [VERIFIED_TRACE]),
    );
    expect(result.status).toBe("INDIRECT");
    expect(result.reason).toContain("toDisplayCurrency");
  });

  it("chains multiple transforms in order", () => {
    const result = classifyValue(
      "revenue",
      snapshot([clientEvent({ transform: ["round", "toCurrency"] })], [VERIFIED_TRACE]),
    );
    expect(result.status).toBe("INDIRECT");
    expect(result.reason).toContain("round → toCurrency");
    const rendered = renderTree(result.tree).join("\n");
    expect(rendered).toContain("round()");
    expect(rendered).toContain("toCurrency()");
  });

  it("catches an undeclared transform by comparing the recorded value", () => {
    const result = classifyValue(
      "revenue",
      // The source returned 91_400 but the DOM shows 91.4 — something changed it.
      snapshot([clientEvent({ value: 91.4 })], [VERIFIED_TRACE]),
    );
    expect(result.status).toBe("INDIRECT");
    expect(result.reason).toContain("different value than the one displayed");
  });
});

describe("classify()", () => {
  it("takes the two raw streams and returns one tree", () => {
    const tree = classify([clientEvent()], [VERIFIED_TRACE]);
    expect(tree.status).toBe("VERIFIED");
    expect(tree.label).toContain("revenue = 91400");
  });

  it("returns an UNTRACED tree when there are no client events at all", () => {
    const tree = classify([], [VERIFIED_TRACE]);
    expect(tree.status).toBe("UNTRACED");
  });

  it("uses the most recent report for an id", () => {
    const tree = classify(
      [
        clientEvent({ value: 1, capturedAt: 1 }),
        clientEvent({ value: 2, capturedAt: 99 }),
      ],
      [],
    );
    expect(tree.label).toContain("= 2");
  });
});

describe("buildReport", () => {
  it("counts every status and computes confidence as (verified + indirect) / tracked", () => {
    const report = buildReport(
      snapshot(
        [
          clientEvent({ id: "revenue", value: 91_400 }),
          clientEvent({ id: "customers", value: 128, transform: "formatCount" }),
          clientEvent({ id: "growth", value: 0.248, traceId: "gt_other" }),
        ],
        [VERIFIED_TRACE],
      ),
    );

    expect(report.tracked).toBe(3);
    expect(report.counts.VERIFIED).toBe(1);
    expect(report.counts.INDIRECT).toBe(1);
    expect(report.counts.UNTRACED).toBe(1);
    expect(report.confidence).toBeCloseTo(2 / 3);
  });

  it("reports null confidence rather than 0% when nothing is tracked", () => {
    const report = buildReport(snapshot([], []));
    expect(report.tracked).toBe(0);
    expect(report.confidence).toBeNull();
  });

  it("drops to below 1 the moment one value falls back", () => {
    const report = buildReport(
      snapshot(
        [clientEvent({ id: "revenue" }), clientEvent({ id: "customers", value: 128 })],
        [FALLBACK_TRACE],
      ),
    );
    expect(report.counts.FALLBACK).toBe(2);
    expect(report.confidence).toBe(0);
  });

  it("orders values worst-status-last so the healthy ones read first", () => {
    const report = buildReport(
      snapshot(
        [
          clientEvent({ id: "revenue" }),
          clientEvent({ id: "orphan", traceId: "gt_none" }),
        ],
        [VERIFIED_TRACE],
      ),
    );
    expect(report.values.map((value) => value.id)).toEqual(["revenue", "orphan"]);
  });
});

describe("helpers", () => {
  it("deepEqual compares structurally", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it("formatValue keeps numbers readable", () => {
    expect(formatValue(184_293)).toBe("184293");
    expect(formatValue(0.248)).toBe("0.248");
    expect(formatValue("hi")).toBe('"hi"');
    expect(formatValue(undefined)).toBe("undefined");
  });

  it("renderTree draws box connectors", () => {
    const lines = renderTree({
      label: "root",
      status: "VERIFIED",
      children: [
        { label: "a", status: "VERIFIED", children: [] },
        { label: "b", status: "FALLBACK", children: [] },
      ],
    });
    expect(lines[0]).toContain("root");
    expect(lines[1]).toContain("├── ");
    expect(lines[2]).toContain("└── ");
  });
});
