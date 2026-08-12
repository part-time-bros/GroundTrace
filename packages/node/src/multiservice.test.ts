/**
 * Multi-service trace propagation.
 *
 * `tracedFetch` sets `x-groundtrace-id` from the ambient context, and every
 * adapter opens its trace from that header — so a call chain across services
 * should land in one trace rather than several. That was true by construction
 * and never actually demonstrated, which is the sort of claim this project is
 * supposed to be suspicious of.
 *
 * Two real HTTP servers, one calling the other.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { sharedStore, type ServerTrace } from "@groundtrace/core";
import { withTrace } from "./context.js";
import { TRACE_HEADER, tracedFetchJson } from "./fetch.js";
import { groundtraceMiddleware } from "./middleware.js";
import { configureCollector } from "./sink.js";

const closers: (() => Promise<void>)[] = [];

beforeEach(() => {
  configureCollector({ url: undefined, local: true });
  sharedStore().clear();
});

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  sharedStore().clear();
});

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function traceFor(traceId: string): Promise<ServerTrace | undefined> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const trace = sharedStore().trace(traceId);
    if (trace !== undefined) return trace;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

/** The downstream service: owns the database. */
async function startPricing(fail: boolean): Promise<string> {
  const app = express();
  app.use(groundtraceMiddleware());

  app.get("/totals", async (_req, res) => {
    if (fail) {
      res.status(503).json({ error: "pricing is down" });
      return;
    }
    const row = await withTrace("pricing-query", async () => ({ revenue: 96_159 }), {
      produces: ["revenue"],
      extract: (result) => result as Record<string, unknown>,
    });
    res.json(row);
  });

  return listen(app);
}

/** The upstream service: the one the browser talks to. */
async function startGateway(pricingUrl: string): Promise<string> {
  const app = express();
  app.use(groundtraceMiddleware());

  app.get("/revenue", async (_req, res) => {
    try {
      const data = await tracedFetchJson<{ revenue: number }>(
        "pricing-service",
        `${pricingUrl}/totals`,
      );
      res.json(data);
    } catch {
      res.json({ revenue: 184_293 });
    }
  });

  return listen(app);
}

describe("a request that crosses two services", () => {
  it("lands in one trace, not two", async () => {
    const gateway = await startGateway(await startPricing(false));

    const response = await fetch(`${gateway}/revenue`, {
      headers: { [TRACE_HEADER]: "gt_chain-1" },
    });
    await expect(response.json()).resolves.toEqual({ revenue: 96_159 });

    const trace = await traceFor("gt_chain-1");
    const sources = trace?.events.map((event) => event.sourceId).sort();

    // The gateway's outbound fetch and the pricing service's query are both
    // here, under the id the browser sent.
    expect(sources).toEqual(["pricing-query", "pricing-service"]);
    expect(sharedStore().traces()).toHaveLength(1);
  });

  it("attributes the failure to the service that actually failed", async () => {
    const gateway = await startGateway(await startPricing(true));

    const response = await fetch(`${gateway}/revenue`, {
      headers: { [TRACE_HEADER]: "gt_chain-2" },
    });
    await expect(response.json()).resolves.toEqual({ revenue: 184_293 });

    const trace = await traceFor("gt_chain-2");
    const failed = trace?.events.filter((event) => event.status === "FALLBACK_TRIGGERED");

    expect(failed).toHaveLength(1);
    expect(failed?.[0]?.sourceId).toBe("pricing-service");
    expect(failed?.[0]?.detail).toContain("503");
  });

  it("still works when the browser sent no id — the gateway mints one and passes it on", async () => {
    const gateway = await startGateway(await startPricing(false));

    const response = await fetch(`${gateway}/revenue`);
    const traceId = response.headers.get(TRACE_HEADER);
    expect(traceId).toMatch(/^gt_/);

    const trace = await traceFor(traceId!);
    expect(trace?.events.map((event) => event.sourceId).sort()).toEqual([
      "pricing-query",
      "pricing-service",
    ]);
  });
});
