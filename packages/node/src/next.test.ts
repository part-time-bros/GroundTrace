import { beforeEach, describe, expect, it } from "vitest";
import { sharedStore } from "@groundtrace/core";
import { withTrace, withTraceSync } from "./context.js";
import { TRACE_HEADER } from "./fetch.js";
import { configureCollector } from "./sink.js";
import { traceIdFrom, traceRoute } from "./next.js";

beforeEach(() => {
  configureCollector({ url: undefined, local: true });
  sharedStore().clear();
});

describe("traceIdFrom", () => {
  it("reuses the caller's trace id", () => {
    const request = new Request("http://localhost/api/revenue", {
      headers: { [TRACE_HEADER]: "gt_from-browser" },
    });
    expect(traceIdFrom(request)).toBe("gt_from-browser");
  });

  it("starts a new trace when the caller didn't send one", () => {
    const request = new Request("http://localhost/api/revenue");
    expect(traceIdFrom(request)).toMatch(/^gt_/);
  });
});

describe("traceRoute", () => {
  it("returns the handler's JSON and echoes the trace id back", async () => {
    const handler = traceRoute(
      async () =>
        withTrace("revenue-query", async () => ({ revenue: 91_400 }), {
          produces: ["revenue"],
          extract: (result) => result as Record<string, unknown>,
        }),
      { route: "/api/revenue" },
    );

    const response = await handler(
      new Request("http://localhost/api/revenue", {
        headers: { [TRACE_HEADER]: "gt_test-1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(TRACE_HEADER)).toBe("gt_test-1");
    await expect(response.json()).resolves.toEqual({ revenue: 91_400 });

    const trace = sharedStore().trace("gt_test-1");
    expect(trace?.route).toBe("/api/revenue");
    expect(trace?.events[0]).toMatchObject({
      sourceId: "revenue-query",
      status: "VERIFIED",
    });
  });

  it("reports the fallback the handler's own catch block chose", async () => {
    const handler = traceRoute(
      async () => {
        try {
          return await withTrace("revenue-query", async () => {
            throw new Error("simulated API failure");
          });
        } catch {
          return { revenue: 184_293 };
        }
      },
      { route: "/api/revenue" },
    );

    const response = await handler(
      new Request("http://localhost/api/revenue", {
        headers: { [TRACE_HEADER]: "gt_test-2" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revenue: 184_293 });
    expect(sharedStore().trace("gt_test-2")?.events[0]).toMatchObject({
      status: "FALLBACK_TRIGGERED",
      detail: "simulated API failure",
    });
  });

  it("still reports the trace when the handler throws uncaught", async () => {
    const handler = traceRoute(async () => {
      withTraceSync("revenue-query", () => {
        throw new Error("db is gone");
      });
    });

    const response = await handler(
      new Request("http://localhost/api/revenue", {
        headers: { [TRACE_HEADER]: "gt_test-3" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db is gone" });
    expect(sharedStore().trace("gt_test-3")?.events).toHaveLength(1);
  });

  it("does not cache responses", async () => {
    const handler = traceRoute(async () => ({ ok: true }));
    const response = await handler(new Request("http://localhost/api/x"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
