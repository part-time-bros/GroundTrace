/**
 * BUILD_SPEC §4 asks for this explicitly: classification has to be exercised
 * against the event shapes §2 and §3 *actually produce*, not against fixtures
 * hand-written to match. So nothing here is synthesised — the server trace comes
 * out of a real `traceRoute` + `instrumentedGet`, and the client events come out
 * of really rendering a component that calls `useTruthValue`.
 *
 * It is also a rehearsal of the §6 demo: the same route, flipped between its two
 * states, has to move the verdict between 🟢 VERIFIED and 🟠 FALLBACK.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  buildReport,
  classifyValue,
  renderTree,
  sharedStore,
  type EventSnapshot,
} from "@groundtrace/core";
import {
  instrumentedGet,
  recordFallbackValue,
  traceRoute,
  withTraceSync,
  type QueryableDatabase,
} from "@groundtrace/node";
import { configureClient, flushNodes, resetClient } from "./client.js";
import { TraceScope } from "./trace-scope.js";
import { useTruthValue } from "./useTruthValue.js";
import { newTraceId, TRACE_HEADER } from "./useTracedQuery.js";

// --- the "database" -------------------------------------------------------
// Same prepared-statement shape as better-sqlite3, seeded with real rows so the
// sum below is a real sum.
const ORDERS = [
  { customer_id: 1, total: 40_000 },
  { customer_id: 2, total: 31_400 },
  { customer_id: 1, total: 20_000 },
];

const REAL_REVENUE = ORDERS.reduce((sum, order) => sum + order.total, 0);
const REAL_CUSTOMERS = new Set(ORDERS.map((order) => order.customer_id)).size;
const PREVIOUS_PERIOD_REVENUE = 80_000;

const DEMO_FALLBACK = { revenue: 184_293, growth: 0.248, customers: 14_293 };

function makeDb(): QueryableDatabase {
  return {
    prepare() {
      return {
        all: () => ORDERS,
        get: () => ({ revenue: REAL_REVENUE, customers: REAL_CUSTOMERS }),
      };
    },
  };
}

const REVENUE_SQL =
  "SELECT SUM(total) AS revenue, COUNT(DISTINCT customer_id) AS customers FROM orders";

/** The §6 route, in miniature: one query, one env flag, one catch block. */
function makeRoute(simulateFailure: boolean) {
  const db = makeDb();
  return traceRoute(
    async () => {
      try {
        if (simulateFailure) {
          throw new Error("SIMULATE_API_FAILURE is on");
        }
        const row = instrumentedGet<{ revenue: number; customers: number }>(
          db,
          "revenue-query",
          REVENUE_SQL,
          [],
          {
            produces: ["revenue", "customers"],
            extract: (result) => result as Record<string, unknown>,
          },
        );
        // Derived values need their own traced step, or they arrive in the DOM
        // with nothing claiming to have produced them — which is UNTRACED, and
        // rightly so.
        const growth = withTraceSync(
          "growth-calc",
          () => row.revenue / PREVIOUS_PERIOD_REVENUE - 1,
          {
            kind: "compute",
            label: "revenue / previousPeriod − 1",
            produces: ["growth"],
            extract: (result) => ({ growth: result }),
          },
        );
        return { ...row, growth };
      } catch (error) {
        // The catch block picks the fallback — GroundTrace only observes it.
        recordFallbackValue(
          "revenue-fallback",
          DEMO_FALLBACK,
          error instanceof Error ? error.message : String(error),
        );
        return DEMO_FALLBACK;
      }
    },
    { route: "/api/revenue" },
  );
}

interface RevenuePayload {
  revenue: number;
  customers: number;
  growth: number;
}

/** Runs the real route handler and returns what a browser would have received. */
async function callRoute(simulateFailure: boolean) {
  const traceId = newTraceId();
  const response = await makeRoute(simulateFailure)(
    new Request("http://localhost/api/revenue", {
      headers: { [TRACE_HEADER]: traceId },
    }),
  );
  const data = (await response.json()) as RevenuePayload;
  return { data, traceId: response.headers.get(TRACE_HEADER) ?? traceId };
}

// --- the dashboard --------------------------------------------------------

function Dashboard({ data, traceId }: { data: RevenuePayload; traceId: string }) {
  return (
    <TraceScope traceId={traceId}>
      <Metric id="revenue" value={data.revenue} />
      <Metric id="customers" value={data.customers} />
      <Metric id="growth" value={data.growth} transform="toPercent" />
    </TraceScope>
  );
}

function Metric({
  id,
  value,
  transform,
}: {
  id: string;
  value: number;
  transform?: string;
}) {
  const tracked = useTruthValue(value, {
    id,
    source: "/api/revenue",
    ...(transform !== undefined ? { transform } : {}),
  });
  return <span data-truth-id={id}>{String(tracked)}</span>;
}

/** Drives the whole loop and hands back exactly what the collector would hold. */
async function runDashboard(simulateFailure: boolean): Promise<EventSnapshot> {
  const { data, traceId } = await callRoute(simulateFailure);
  render(<Dashboard data={data} traceId={traceId} />);
  await act(async () => {
    await flushNodes();
  });
  return sharedStore().snapshot();
}

beforeEach(() => {
  resetClient();
  sharedStore().clear();
  // Client events go into the same store the server writes traces to, which is
  // exactly what the in-process collector does in the demo.
  configureClient({
    transport: (events) => {
      sharedStore().recordNodes(events);
    },
  });
});

afterEach(() => {
  cleanup();
  resetClient();
  sharedStore().clear();
});

describe("healthy state — SIMULATE_API_FAILURE off", () => {
  it("classifies the revenue number VERIFIED, ending at the real query", async () => {
    const snapshot = await runDashboard(false);
    const revenue = classifyValue("revenue", snapshot);

    expect(revenue.status).toBe("VERIFIED");
    expect(revenue.value).toBe(REAL_REVENUE);

    const tree = renderTree(revenue.tree).join("\n");
    expect(tree).toContain("🟢");
    expect(tree).toContain(REVENUE_SQL);
  });

  it("proves the displayed number is the number the query returned", async () => {
    const snapshot = await runDashboard(false);
    expect(classifyValue("customers", snapshot)).toMatchObject({
      status: "VERIFIED",
      value: REAL_CUSTOMERS,
    });
    expect(classifyValue("revenue", snapshot).reason).toContain(
      "matches what it returned",
    );
  });

  it("classifies the transformed value INDIRECT, not VERIFIED", async () => {
    const snapshot = await runDashboard(false);
    const growth = classifyValue("growth", snapshot);
    expect(growth.status).toBe("INDIRECT");
    expect(growth.reason).toContain("toPercent");
  });

  it("reports 100% confidence — every value is verified or indirect", async () => {
    const report = buildReport(await runDashboard(false));
    expect(report.tracked).toBe(3);
    expect(report.confidence).toBe(1);
    expect(report.counts.FALLBACK).toBe(0);
  });
});

describe("broken state — SIMULATE_API_FAILURE on", () => {
  it("classifies the revenue number FALLBACK, ending at the catch block", async () => {
    const snapshot = await runDashboard(true);
    const revenue = classifyValue("revenue", snapshot);

    expect(revenue.status).toBe("FALLBACK");
    expect(revenue.value).toBe(DEMO_FALLBACK.revenue);
    expect(revenue.reason).toContain("not backed by live data");

    const tree = renderTree(revenue.tree).join("\n");
    expect(tree).toContain("🟠");
    expect(tree).toContain("catch block returned a hardcoded value");
    expect(tree).toContain("SIMULATE_API_FAILURE is on");
  });

  it("flags every value fed by the failed route, not just the one clicked", async () => {
    const snapshot = await runDashboard(true);
    for (const id of ["revenue", "customers", "growth"]) {
      expect(classifyValue(id, snapshot).status).toBe("FALLBACK");
    }
  });

  it("drops confidence to 0%", async () => {
    const report = buildReport(await runDashboard(true));
    expect(report.tracked).toBe(3);
    expect(report.confidence).toBe(0);
    expect(report.counts.FALLBACK).toBe(3);
  });
});

describe("the toggle", () => {
  it("moves the same value between VERIFIED and FALLBACK", async () => {
    const broken = classifyValue("revenue", await runDashboard(true));
    cleanup();
    sharedStore().clear();
    const healthy = classifyValue("revenue", await runDashboard(false));

    expect(broken.status).toBe("FALLBACK");
    expect(healthy.status).toBe("VERIFIED");
    expect(broken.value).not.toBe(healthy.value);
  });

  it("never lets the fallback value be mistaken for the real one", async () => {
    const healthy = classifyValue("revenue", await runDashboard(false));
    expect(healthy.value).toBe(REAL_REVENUE);
    expect(healthy.value).not.toBe(DEMO_FALLBACK.revenue);
  });
});
