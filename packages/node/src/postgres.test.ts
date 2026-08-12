import { describe, expect, it } from "vitest";
import { runWithTrace, type TraceContext } from "./context.js";
import {
  instrumentedGetAsync,
  instrumentedQueryAsync,
  type AsyncQueryable,
} from "./postgres.js";

/** Stands in for a `pg` Client or Pool — same `query(text, values)` contract. */
function fakePg(rows: unknown[], failWith?: Error): AsyncQueryable {
  return {
    async query<T>(_text: string, values?: unknown[]) {
      if (failWith) throw failWith;
      const extra = (values ?? []) as unknown[];
      return { rows: [...rows, ...extra] as T[], rowCount: rows.length };
    },
  };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("instrumentedQueryAsync", () => {
  it("returns rows and records the SQL as the tree label", async () => {
    const db = fakePg([{ revenue: 91_400 }]);
    const ctx = await runWithTrace("t", async (traceCtx: TraceContext) => {
      const rows = await instrumentedQueryAsync<{ revenue: number }>(
        db,
        "revenue-query",
        "SELECT SUM(total) AS revenue\n  FROM orders",
      );
      expect(rows).toEqual([{ revenue: 91_400 }]);
      return traceCtx;
    });

    expect(ctx.events[0]).toMatchObject({
      sourceId: "revenue-query",
      status: "VERIFIED",
      kind: "db",
      label: "SELECT SUM(total) AS revenue FROM orders",
    });
  });

  it("passes params through", async () => {
    const db = fakePg([]);
    await runWithTrace("t", async () => {
      const rows = await instrumentedQueryAsync(db, "q", "SELECT $1", [2026]);
      expect(rows).toEqual([2026]);
    });
  });

  it("records a rejected query as FALLBACK_TRIGGERED and re-throws", async () => {
    const db = fakePg([], new Error('relation "orders" does not exist'));
    const ctx = await runWithTrace("t", async (traceCtx) => {
      await expect(
        instrumentedQueryAsync(db, "revenue-query", "SELECT 1"),
      ).rejects.toThrow('relation "orders" does not exist');
      return traceCtx;
    });

    expect(ctx.events[0]).toMatchObject({
      status: "FALLBACK_TRIGGERED",
      detail: 'relation "orders" does not exist',
      kind: "db",
    });
  });
});

describe("instrumentedGetAsync", () => {
  it("returns one row and extracts the values it produced", async () => {
    const db = fakePg([{ revenue: 91_400, customers: 128 }]);
    const ctx = await runWithTrace("t", async (traceCtx) => {
      const row = await instrumentedGetAsync<{ revenue: number; customers: number }>(
        db,
        "revenue-query",
        "SELECT SUM(total) AS revenue, COUNT(DISTINCT customer_id) AS customers FROM orders",
        [],
        {
          produces: ["revenue", "customers"],
          extract: (result) => result as Record<string, unknown>,
        },
      );
      expect(row?.revenue).toBe(91_400);
      return traceCtx;
    });

    expect(ctx.events[0]?.values).toEqual({ revenue: 91_400, customers: 128 });
    expect(ctx.events[0]?.produces).toEqual(["revenue", "customers"]);
  });

  it("treats an empty result as a real answer, not a failure", async () => {
    const db = fakePg([]);
    const ctx = await runWithTrace("t", async (traceCtx) => {
      // A query that matches nothing worked. Recording it as FALLBACK_TRIGGERED
      // would report a healthy query as broken.
      await expect(instrumentedGetAsync(db, "q", "SELECT 1 WHERE false")).resolves.toBe(
        undefined,
      );
      return traceCtx;
    });
    expect(ctx.events[0]?.status).toBe("VERIFIED");
  });

  it("honours an explicit label over the raw SQL", async () => {
    const db = fakePg([{ revenue: 1 }]);
    const ctx = await runWithTrace("t", async (traceCtx) => {
      await instrumentedGetAsync(db, "q", "SELECT 1", [], { label: "orders.total" });
      return traceCtx;
    });
    expect(ctx.events[0]?.label).toBe("orders.total");
  });
});

describe("concurrency", () => {
  it("keeps two overlapping async queries in their own traces", async () => {
    const good = fakePg([{ revenue: 91_400 }]);
    const bad = fakePg([], new Error("connection terminated"));

    let goodCtx!: TraceContext;
    let badCtx!: TraceContext;

    await Promise.all([
      runWithTrace("trace-good", async (ctx) => {
        goodCtx = ctx;
        await tick(10);
        await instrumentedQueryAsync(good, "revenue-query", "SELECT 1");
      }),
      runWithTrace("trace-bad", async (ctx) => {
        badCtx = ctx;
        await tick(5);
        await instrumentedQueryAsync(bad, "revenue-query", "SELECT 1").catch(
          () => undefined,
        );
      }),
    ]);

    expect(goodCtx.events).toHaveLength(1);
    expect(goodCtx.events[0]?.status).toBe("VERIFIED");
    expect(badCtx.events).toHaveLength(1);
    expect(badCtx.events[0]?.status).toBe("FALLBACK_TRIGGERED");
  });
});
