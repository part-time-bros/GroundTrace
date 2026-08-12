import { describe, expect, it } from "vitest";
import { runWithTrace, type TraceContext } from "./context.js";
import { instrumentedGet, instrumentedQuery, type QueryableDatabase } from "./sqlite.js";

/** Stands in for better-sqlite3 / node:sqlite — same prepared-statement shape. */
function fakeDb(rows: unknown[], failWith?: Error): QueryableDatabase {
  return {
    prepare() {
      return {
        all(...params: unknown[]) {
          if (failWith) throw failWith;
          return [...rows, ...params];
        },
        get() {
          if (failWith) throw failWith;
          return rows[0];
        },
      };
    },
  };
}

describe("instrumentedQuery", () => {
  it("returns rows and records the SQL as the tree label", () => {
    const db = fakeDb([{ revenue: 91_400 }]);
    const ctx = runWithTrace("t", (traceCtx: TraceContext) => {
      const rows = instrumentedQuery<{ revenue: number }[]>(
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

  it("passes params through to the statement", () => {
    const db = fakeDb([]);
    runWithTrace("t", () => {
      const rows = instrumentedQuery<unknown[]>(db, "q", "SELECT ?", [2024]);
      expect(rows).toEqual([2024]);
    });
  });

  it("records a failed query as FALLBACK_TRIGGERED and re-throws", () => {
    const db = fakeDb([], new Error("no such table: orders"));
    const ctx = runWithTrace("t", (traceCtx) => {
      expect(() => instrumentedQuery(db, "revenue-query", "SELECT 1")).toThrow(
        "no such table: orders",
      );
      return traceCtx;
    });

    expect(ctx.events[0]).toMatchObject({
      status: "FALLBACK_TRIGGERED",
      detail: "no such table: orders",
      kind: "db",
    });
  });
});

describe("instrumentedGet", () => {
  it("returns one row and can extract the values it produced", () => {
    const db = fakeDb([{ revenue: 91_400, customers: 128 }]);
    const ctx = runWithTrace("t", (traceCtx) => {
      const row = instrumentedGet<{ revenue: number; customers: number }>(
        db,
        "revenue-query",
        "SELECT SUM(total) AS revenue, COUNT(DISTINCT customer_id) AS customers FROM orders",
        [],
        {
          produces: ["revenue", "customers"],
          extract: (result) => result as Record<string, unknown>,
        },
      );
      expect(row.revenue).toBe(91_400);
      return traceCtx;
    });

    expect(ctx.events[0]?.values).toEqual({ revenue: 91_400, customers: 128 });
    expect(ctx.events[0]?.produces).toEqual(["revenue", "customers"]);
  });

  it("honours an explicit label over the raw SQL", () => {
    const db = fakeDb([{ revenue: 1 }]);
    const ctx = runWithTrace("t", (traceCtx) => {
      instrumentedGet(db, "q", "SELECT 1", [], { label: "orders.total" });
      return traceCtx;
    });
    expect(ctx.events[0]?.label).toBe("orders.total");
  });
});
