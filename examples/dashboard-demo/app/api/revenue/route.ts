/**
 * The route the whole demo turns on.
 *
 * Read it as an unremarkable API route: query the database, and if anything
 * goes wrong fall back to something sensible so the dashboard still renders.
 * That catch block is the bug — it makes a broken page look like a working one,
 * and nothing about the response says which of the two you're looking at.
 *
 * GroundTrace changes nothing here except adding observation.
 */
import {
  instrumentedGet,
  recordFallbackValue,
  traceRoute,
  withTraceSync,
} from "@groundtrace/node";
import {
  PREVIOUS_PERIOD_SQL,
  REVENUE_SQL,
  getDb,
  type RevenueRow,
} from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exactly the numbers the original pitch shows, so the demo matches it. */
export const DEMO_FALLBACK = { revenue: 184_293, growth: 0.248, customers: 14_293 };

export interface RevenuePayload {
  revenue: number;
  growth: number;
  customers: number;
  /** Purely cosmetic — the dashboard has no idea this is a fallback. */
  asOf: string;
}

/**
 * Defaults to `true`: the demo should open on the gotcha state, not the healthy
 * one. The header toggle sends `?fail=0` / `?fail=1` to flip it live.
 */
function shouldSimulateFailure(request: Request): boolean {
  const override = new URL(request.url).searchParams.get("fail");
  if (override !== null) return override !== "0" && override !== "false";
  return process.env["SIMULATE_API_FAILURE"] !== "false";
}

export const GET = traceRoute(
  (request) => {
    try {
      if (shouldSimulateFailure(request)) {
        throw new Error("upstream revenue service returned 503 (SIMULATE_API_FAILURE)");
      }

      const db = getDb();

      const current = instrumentedGet<RevenueRow>(db, "revenue-query", REVENUE_SQL, [], {
        produces: ["revenue", "customers"],
        extract: (row) => row as Record<string, unknown>,
      });

      const previous = instrumentedGet<{ revenue: number }>(
        db,
        "previous-period-query",
        PREVIOUS_PERIOD_SQL,
      );

      // Derived values need their own traced step. Without one, `growth` reaches
      // the DOM with nothing claiming to have produced it — UNTRACED, correctly.
      const growth = withTraceSync(
        "growth-calc",
        () => current.revenue / previous.revenue - 1,
        {
          kind: "compute",
          label: "revenue ÷ previousPeriod − 1",
          produces: ["growth"],
          extract: (value) => ({ growth: value }),
        },
      );

      return {
        revenue: current.revenue,
        customers: current.customers,
        growth,
        asOf: new Date().toISOString(),
      } satisfies RevenuePayload;
    } catch (error) {
      // A perfectly ordinary catch block. The dashboard renders, the build is
      // green, the tests pass — and every number on screen is made up.
      recordFallbackValue(
        "revenue-fallback",
        DEMO_FALLBACK,
        error instanceof Error ? error.message : String(error),
      );
      return {
        ...DEMO_FALLBACK,
        asOf: new Date().toISOString(),
      } satisfies RevenuePayload;
    }
  },
  { route: "/api/revenue" },
);
