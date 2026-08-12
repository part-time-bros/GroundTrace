import { beforeEach, describe, expect, it } from "vitest";
import { sharedStore } from "@groundtrace/core";
import { withTrace, withTraceSync } from "./context.js";
import { configureCollector } from "./sink.js";
import { traceIdFromNextHeaders, traceServerRender } from "./rsc.js";

beforeEach(() => {
  configureCollector({ url: undefined, local: true });
  sharedStore().clear();
});

describe("traceServerRender", () => {
  it("traces a server component that queries directly, with no API route at all", async () => {
    const { data, traceId } = await traceServerRender(
      async () =>
        withTrace("revenue-query", async () => ({ revenue: 96_159 }), {
          produces: ["revenue"],
          extract: (row) => row as Record<string, unknown>,
        }),
      { route: "/dashboard" },
    );

    expect(data).toEqual({ revenue: 96_159 });
    expect(traceId).toMatch(/^gt_/);

    const trace = sharedStore().trace(traceId);
    expect(trace?.route).toBe("/dashboard");
    expect(trace?.events[0]).toMatchObject({
      sourceId: "revenue-query",
      status: "VERIFIED",
    });
    expect(trace?.events[0]?.values).toEqual({ revenue: 96_159 });
  });

  it("records the fallback a server component's catch block chose", async () => {
    const { data, traceId } = await traceServerRender(async () => {
      try {
        return await withTrace("revenue-query", async () => {
          throw new Error("upstream 503");
        });
      } catch {
        return { revenue: 184_293 };
      }
    });

    expect(data).toEqual({ revenue: 184_293 });
    expect(sharedStore().trace(traceId)?.events[0]).toMatchObject({
      status: "FALLBACK_TRIGGERED",
      detail: "upstream 503",
    });
  });

  it("still reports when the render throws uncaught, then re-throws", async () => {
    await expect(
      traceServerRender(
        () => {
          withTraceSync("revenue-query", () => {
            throw new Error("db is gone");
          });
        },
        { traceId: "gt_rsc-throw" },
      ),
    ).rejects.toThrow("db is gone");

    expect(sharedStore().trace("gt_rsc-throw")?.events).toHaveLength(1);
  });

  it("reuses a caller's id so nested renders stay in one trace", async () => {
    const { traceId } = await traceServerRender(async () => 1, {
      traceId: "gt_supplied",
    });
    expect(traceId).toBe("gt_supplied");
  });

  it("keeps two concurrent renders isolated", async () => {
    const [good, bad] = await Promise.all([
      traceServerRender(async () => withTrace("q", async () => 1), {
        traceId: "gt_rsc-good",
      }),
      traceServerRender(
        async () => {
          try {
            return await withTrace("q", async () => {
              throw new Error("nope");
            });
          } catch {
            return 0;
          }
        },
        { traceId: "gt_rsc-bad" },
      ),
    ]);

    expect(sharedStore().trace(good.traceId)?.events[0]?.status).toBe("VERIFIED");
    expect(sharedStore().trace(bad.traceId)?.events[0]?.status).toBe(
      "FALLBACK_TRIGGERED",
    );
  });
});

describe("traceIdFromNextHeaders", () => {
  it("reads an inbound id", () => {
    const headers = {
      get: (name: string) => (name === "x-groundtrace-id" ? "gt_in" : null),
    };
    expect(traceIdFromNextHeaders(headers)).toBe("gt_in");
  });

  it("is undefined for a plain navigation, which carries no header", () => {
    expect(traceIdFromNextHeaders({ get: () => null })).toBeUndefined();
    expect(traceIdFromNextHeaders(undefined)).toBeUndefined();
  });
});
