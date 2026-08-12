/**
 * The same dashboard, fetched in a React Server Component.
 *
 * No API route, no client fetch, no `x-groundtrace-id` header — the page queries
 * SQLite directly during render, which is how a large share of App Router apps
 * are actually written. `traceServerRender` opens the trace and hands back an id
 * for the client components to join, so the overlay behaves exactly as it does
 * on the fetch-based page.
 */
import { headers } from "next/headers";
import {
  instrumentedGet,
  recordFallbackValue,
  traceIdFromNextHeaders,
  traceServerRender,
  withTraceSync,
} from "@groundtrace/node";
import { ServerMetrics } from "../../components/ServerMetrics";
import { PREVIOUS_PERIOD_SQL, REVENUE_SQL, getDb, type RevenueRow } from "../../lib/db";
import { DEMO_FALLBACK } from "../api/revenue/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ServerDashboardPage() {
  const inbound = traceIdFromNextHeaders(await headers());
  const simulateFailure = process.env["SIMULATE_API_FAILURE"] !== "false";

  const { data, traceId } = await traceServerRender(
    () => {
      try {
        if (simulateFailure) {
          throw new Error("upstream revenue service returned 503 (SIMULATE_API_FAILURE)");
        }

        const db = getDb();
        const current = instrumentedGet<RevenueRow>(
          db,
          "revenue-query",
          REVENUE_SQL,
          [],
          {
            produces: ["revenue", "customers"],
            extract: (row) => row as Record<string, unknown>,
          },
        );
        const previous = instrumentedGet<{ revenue: number }>(
          db,
          "previous-period-query",
          PREVIOUS_PERIOD_SQL,
        );
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

        return { revenue: current.revenue, customers: current.customers, growth };
      } catch (error) {
        recordFallbackValue(
          "revenue-fallback",
          DEMO_FALLBACK,
          error instanceof Error ? error.message : String(error),
        );
        return DEMO_FALLBACK;
      }
    },
    { route: "/server", ...(inbound !== undefined ? { traceId: inbound } : {}) },
  );

  return <ServerMetrics data={data} traceId={traceId} />;
}
