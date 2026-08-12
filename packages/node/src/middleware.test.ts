/**
 * Exercised against real Express and Fastify apps over real HTTP. Mocking the
 * frameworks would prove the adapters match my idea of their shapes, which is
 * exactly the thing worth not assuming.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { sharedStore, type ServerTrace } from "@groundtrace/core";
import express from "express";
import Fastify from "fastify";
import { withTrace, withTraceSync } from "./context.js";
import { TRACE_HEADER } from "./fetch.js";
import { configureCollector } from "./sink.js";
import {
  groundtraceFastify,
  groundtraceMiddleware,
  traceIdFromHeaders,
} from "./middleware.js";

const closers: (() => Promise<void>)[] = [];

beforeEach(() => {
  configureCollector({ url: undefined, local: true });
  sharedStore().clear();
});

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  sharedStore().clear();
});

/** Waits for the trace to land — reporting happens on response finish. */
async function traceFor(traceId: string): Promise<ServerTrace | undefined> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const trace = sharedStore().trace(traceId);
    if (trace !== undefined) return trace;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

describe("traceIdFromHeaders", () => {
  it("reuses the caller's id", () => {
    expect(traceIdFromHeaders({ [TRACE_HEADER]: "gt_incoming" })).toBe("gt_incoming");
  });

  it("takes the first value when a header repeats", () => {
    expect(traceIdFromHeaders({ [TRACE_HEADER]: ["gt_a", "gt_b"] })).toBe("gt_a");
  });

  it("mints one when the caller sent none", () => {
    expect(traceIdFromHeaders({})).toMatch(/^gt_/);
  });
});

describe("Express", () => {
  async function startExpress(): Promise<string> {
    const app = express();
    app.use(groundtraceMiddleware());

    app.get("/revenue", async (_req, res) => {
      const row = await withTrace("revenue-query", async () => ({ revenue: 91_400 }), {
        produces: ["revenue"],
        extract: (result) => result as Record<string, unknown>,
      });
      res.json(row);
    });

    app.get("/broken", async (_req, res) => {
      try {
        await withTrace("revenue-query", async () => {
          throw new Error("upstream 503");
        });
      } catch {
        res.json({ revenue: 184_293 });
      }
    });

    app.get("/throws", () => {
      withTraceSync("revenue-query", () => {
        throw new Error("db is gone");
      });
    });

    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("produces the same ServerTrace shape as traceRoute", async () => {
    const base = await startExpress();
    const response = await fetch(`${base}/revenue`, {
      headers: { [TRACE_HEADER]: "gt_express-1" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revenue: 91_400 });

    const trace = await traceFor("gt_express-1");
    expect(trace?.route).toBe("/revenue");
    expect(trace?.events[0]).toMatchObject({
      sourceId: "revenue-query",
      status: "VERIFIED",
    });
    expect(trace?.events[0]?.values).toEqual({ revenue: 91_400 });
  });

  it("echoes the trace id back", async () => {
    const base = await startExpress();
    const response = await fetch(`${base}/revenue`, {
      headers: { [TRACE_HEADER]: "gt_express-2" },
    });
    expect(response.headers.get(TRACE_HEADER)).toBe("gt_express-2");
  });

  it("records the fallback a catch block chose", async () => {
    const base = await startExpress();
    await fetch(`${base}/broken`, { headers: { [TRACE_HEADER]: "gt_express-3" } });

    const trace = await traceFor("gt_express-3");
    expect(trace?.events[0]).toMatchObject({
      status: "FALLBACK_TRIGGERED",
      detail: "upstream 503",
    });
  });

  it("still reports when the handler throws uncaught", async () => {
    const base = await startExpress();
    await fetch(`${base}/throws`, { headers: { [TRACE_HEADER]: "gt_express-4" } }).catch(
      () => undefined,
    );

    const trace = await traceFor("gt_express-4");
    expect(trace?.events).toHaveLength(1);
    expect(trace?.events[0]?.status).toBe("FALLBACK_TRIGGERED");
  });

  it("mints a trace id when the caller sends none", async () => {
    const base = await startExpress();
    const response = await fetch(`${base}/revenue`);
    expect(response.headers.get(TRACE_HEADER)).toMatch(/^gt_/);
  });

  it("keeps concurrent requests isolated", async () => {
    const base = await startExpress();
    await Promise.all([
      fetch(`${base}/revenue`, { headers: { [TRACE_HEADER]: "gt_conc-good" } }),
      fetch(`${base}/broken`, { headers: { [TRACE_HEADER]: "gt_conc-bad" } }),
    ]);

    const good = await traceFor("gt_conc-good");
    const bad = await traceFor("gt_conc-bad");

    expect(good?.events).toHaveLength(1);
    expect(good?.events[0]?.status).toBe("VERIFIED");
    expect(bad?.events).toHaveLength(1);
    expect(bad?.events[0]?.status).toBe("FALLBACK_TRIGGERED");
  });
});

describe("Fastify", () => {
  async function startFastify(): Promise<string> {
    const app = Fastify();
    await app.register(groundtraceFastify);

    app.get("/revenue", async () =>
      withTrace("revenue-query", async () => ({ revenue: 91_400 }), {
        produces: ["revenue"],
        extract: (result) => result as Record<string, unknown>,
      }),
    );

    app.get("/broken", async () => {
      try {
        return await withTrace("revenue-query", async () => {
          throw new Error("upstream 503");
        });
      } catch {
        return { revenue: 184_293 };
      }
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    closers.push(() => app.close());
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  it("produces the same ServerTrace shape", async () => {
    const base = await startFastify();
    const response = await fetch(`${base}/revenue`, {
      headers: { [TRACE_HEADER]: "gt_fastify-1" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revenue: 91_400 });

    const trace = await traceFor("gt_fastify-1");
    expect(trace?.route).toBe("/revenue");
    expect(trace?.events[0]).toMatchObject({
      sourceId: "revenue-query",
      status: "VERIFIED",
    });
  });

  it("echoes the trace id back", async () => {
    const base = await startFastify();
    const response = await fetch(`${base}/revenue`, {
      headers: { [TRACE_HEADER]: "gt_fastify-2" },
    });
    expect(response.headers.get(TRACE_HEADER)).toBe("gt_fastify-2");
  });

  it("records a fallback", async () => {
    const base = await startFastify();
    await fetch(`${base}/broken`, { headers: { [TRACE_HEADER]: "gt_fastify-3" } });

    const trace = await traceFor("gt_fastify-3");
    expect(trace?.events[0]).toMatchObject({
      status: "FALLBACK_TRIGGERED",
      detail: "upstream 503",
    });
  });

  it("keeps concurrent requests isolated", async () => {
    const base = await startFastify();
    await Promise.all([
      fetch(`${base}/revenue`, { headers: { [TRACE_HEADER]: "gt_fc-good" } }),
      fetch(`${base}/broken`, { headers: { [TRACE_HEADER]: "gt_fc-bad" } }),
    ]);

    expect((await traceFor("gt_fc-good"))?.events[0]?.status).toBe("VERIFIED");
    expect((await traceFor("gt_fc-bad"))?.events[0]?.status).toBe("FALLBACK_TRIGGERED");
  });
});
