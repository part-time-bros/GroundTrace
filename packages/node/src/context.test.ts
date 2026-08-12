import { describe, expect, it } from "vitest";
import {
  getTraceContext,
  newTraceId,
  recordFallbackValue,
  runWithTrace,
  toServerTrace,
  withTrace,
  withTraceSync,
  type TraceContext,
} from "./context.js";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runWithTrace", () => {
  it("makes the context readable from inside and hands it to the callback", () => {
    const seen = runWithTrace("trace-1", (ctx) => {
      expect(getTraceContext()).toBe(ctx);
      return ctx.traceId;
    });
    expect(seen).toBe("trace-1");
  });

  it("leaves no context behind once it returns", () => {
    runWithTrace("trace-1", () => undefined);
    expect(getTraceContext()).toBeUndefined();
  });

  it("survives across await points", async () => {
    await runWithTrace("trace-async", async () => {
      await tick(5);
      expect(getTraceContext()?.traceId).toBe("trace-async");
    });
  });

  it("mints unique ids", () => {
    expect(newTraceId()).not.toBe(newTraceId());
  });
});

describe("concurrent request isolation", () => {
  it("keeps two overlapping requests' events entirely separate", async () => {
    let goodCtx!: TraceContext;
    let badCtx!: TraceContext;

    const good = runWithTrace(
      "trace-good",
      async (ctx) => {
        goodCtx = ctx;
        // Interleave deliberately: this await lands *inside* the other request's
        // work, which is exactly when a global would cross-contaminate.
        await tick(10);
        return withTrace("revenue-query", async () => {
          await tick(10);
          return { revenue: 91_400 };
        });
      },
      { route: "/api/revenue" },
    );

    const bad = runWithTrace(
      "trace-bad",
      async (ctx) => {
        badCtx = ctx;
        await tick(5);
        try {
          await withTrace("revenue-query", async () => {
            await tick(10);
            throw new Error("simulated API failure");
          });
        } catch {
          return { revenue: 184_293 };
        }
      },
      { route: "/api/revenue" },
    );

    const [goodResult, badResult] = await Promise.all([good, bad]);

    expect(goodResult).toEqual({ revenue: 91_400 });
    expect(badResult).toEqual({ revenue: 184_293 });

    expect(goodCtx.events).toHaveLength(1);
    expect(goodCtx.events[0]).toMatchObject({
      sourceId: "revenue-query",
      status: "VERIFIED",
    });
    expect(goodCtx.events[0]?.detail).toBeUndefined();

    expect(badCtx.events).toHaveLength(1);
    expect(badCtx.events[0]).toMatchObject({
      sourceId: "revenue-query",
      status: "FALLBACK_TRIGGERED",
      detail: "simulated API failure",
    });
  });

  it("keeps ten interleaved requests from leaking into each other", async () => {
    const contexts: TraceContext[] = [];
    await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        runWithTrace(`trace-${index}`, async (ctx) => {
          contexts.push(ctx);
          await tick(Math.random() * 10);
          await withTrace(`source-${index}`, async () => index);
        }),
      ),
    );

    expect(contexts).toHaveLength(10);
    for (const ctx of contexts) {
      const index = ctx.traceId.split("-")[1];
      expect(ctx.events).toHaveLength(1);
      expect(ctx.events[0]?.sourceId).toBe(`source-${index}`);
    }
  });
});

describe("withTrace", () => {
  it("re-throws so the caller's catch block still owns the fallback decision", async () => {
    await expect(
      runWithTrace("trace-1", () =>
        withTrace("boom", () => {
          throw new Error("nope");
        }),
      ),
    ).rejects.toThrow("nope");
  });

  it("records extracted values so the classifier can prove a passthrough", async () => {
    const ctx = await runWithTrace("trace-1", async (traceCtx) => {
      await withTrace("revenue-query", async () => ({ revenue: 42 }), {
        produces: ["revenue"],
        extract: (result) => ({ revenue: (result as { revenue: number }).revenue }),
      });
      return traceCtx;
    });

    expect(ctx.events[0]?.values).toEqual({ revenue: 42 });
    expect(ctx.events[0]?.produces).toEqual(["revenue"]);
  });

  it("does not let a broken extractor turn a healthy call into a failure", async () => {
    const ctx = await runWithTrace("trace-1", async (traceCtx) => {
      const result = await withTrace("revenue-query", async () => 7, {
        extract: () => {
          throw new Error("extractor is buggy");
        },
      });
      expect(result).toBe(7);
      return traceCtx;
    });

    expect(ctx.events[0]?.status).toBe("VERIFIED");
    expect(ctx.events[0]?.values).toBeUndefined();
  });

  it("records a duration", async () => {
    const ctx = await runWithTrace("trace-1", async (traceCtx) => {
      await withTrace("slow", async () => {
        await tick(15);
      });
      return traceCtx;
    });
    expect(ctx.events[0]?.durationMs).toBeGreaterThanOrEqual(10);
  });
});

describe("fail-open behaviour outside a trace", () => {
  it("withTrace still runs the wrapped call and records nothing", async () => {
    expect(getTraceContext()).toBeUndefined();
    await expect(withTrace("orphan", async () => "value")).resolves.toBe("value");
  });

  it("withTrace still propagates the error", async () => {
    await expect(
      withTrace("orphan", () => {
        throw new Error("still throws");
      }),
    ).rejects.toThrow("still throws");
  });

  it("withTraceSync is fail-open too", () => {
    expect(withTraceSync("orphan", () => 5)).toBe(5);
  });

  it("recordFallbackValue outside a trace is a no-op, not a crash", () => {
    expect(() => recordFallbackValue("orphan", { revenue: 1 })).not.toThrow();
  });
});

describe("withTraceSync", () => {
  it("records a synchronous success", () => {
    const ctx = runWithTrace("trace-1", (traceCtx) => {
      withTraceSync("sum", () => 3, { kind: "db", label: "SELECT 3" });
      return traceCtx;
    });
    expect(ctx.events[0]).toMatchObject({
      sourceId: "sum",
      status: "VERIFIED",
      kind: "db",
      label: "SELECT 3",
    });
  });

  it("records a synchronous failure and re-throws", () => {
    const ctx = runWithTrace("trace-1", (traceCtx) => {
      expect(() =>
        withTraceSync("sum", () => {
          throw new Error("no such table: orders");
        }),
      ).toThrow("no such table: orders");
      return traceCtx;
    });
    expect(ctx.events[0]).toMatchObject({
      status: "FALLBACK_TRIGGERED",
      detail: "no such table: orders",
    });
  });
});

describe("recordFallbackValue", () => {
  it("records what the catch block actually substituted", () => {
    const ctx = runWithTrace("trace-1", (traceCtx) => {
      recordFallbackValue(
        "revenue-fallback",
        { revenue: 184_293, customers: 14_293 },
        "simulated API failure",
      );
      return traceCtx;
    });

    expect(ctx.events[0]).toMatchObject({
      sourceId: "revenue-fallback",
      status: "FALLBACK_TRIGGERED",
      detail: "simulated API failure",
      produces: ["revenue", "customers"],
      values: { revenue: 184_293, customers: 14_293 },
    });
  });
});

describe("toServerTrace", () => {
  it("freezes a context into the serialisable collector shape", () => {
    const ctx = runWithTrace(
      "trace-1",
      (traceCtx) => {
        withTraceSync("q", () => 1);
        return traceCtx;
      },
      { route: "/api/revenue" },
    );

    const trace = toServerTrace(ctx);
    expect(trace.traceId).toBe("trace-1");
    expect(trace.route).toBe("/api/revenue");
    expect(trace.endedAt).toBeGreaterThanOrEqual(trace.startedAt);
    expect(trace.events).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });
});
