/**
 * Exercised through a real in-memory MCP client rather than by calling the tool
 * callbacks directly — the point is that an agent can actually reach these, so
 * the transport, schemas, and registration all have to work.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { saveVerifyResult, type VerifyResult } from "groundtrace";
import { createServer, describeReport, summariseValues } from "./server.js";

let dir: string;
let client: Client;

function sampleResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    build: { command: "next build", ran: true, exitCode: 0, tail: "" },
    tests: {
      command: "vitest run",
      exitCode: 0,
      executed: true,
      runner: "vitest",
      testsDiscovered: 12,
      testsPassed: 12,
      testsFailed: null,
      raw: "",
    },
    provenance: {
      ran: true,
      basis: "dom",
      routesExercised: 1,
      idsFromSource: 2,
      report: {
        values: [
          {
            id: "customers",
            status: "VERIFIED",
            value: 29,
            source: "/api/revenue",
            reason: '"revenue-query" succeeded and the displayed value matches',
            tree: { label: "customers = 29", status: "VERIFIED", children: [] },
            capturedAt: 2,
          },
          {
            id: "revenue",
            status: "FALLBACK",
            value: 184293,
            source: "/api/revenue",
            reason:
              '"revenue-fallback" failed: upstream 503 — this value is not backed by live data',
            tree: {
              label: "revenue = 184293",
              status: "FALLBACK",
              children: [
                {
                  label: "catch block returned a hardcoded value",
                  status: "FALLBACK",
                  children: [],
                },
              ],
            },
            capturedAt: 1,
          },
        ],
        tracked: 2,
        counts: { VERIFIED: 1, INDIRECT: 0, FALLBACK: 1, SYNTHETIC: 0, UNTRACED: 0 },
        confidence: 0.5,
        generatedAt: 1,
      },
    },
    generatedAt: 1,
    ...overrides,
  };
}

async function connect(cwd: string): Promise<Client> {
  const server = createServer({ cwd });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const created = new Client({ name: "test-agent", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), created.connect(clientTransport)]);
  return created;
}

interface TextResult {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<TextResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as TextResult;
}

function bodyOf(result: TextResult): string {
  return result.content.map((part) => part.text).join("\n");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "groundtrace-mcp-"));
  client = await connect(dir);
});

afterEach(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("tool registration", () => {
  it("advertises every tool an agent needs to check its own work", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "explain_value",
      "last_report",
      "list_tracked_values",
      "verify_app",
      "verify_tests",
    ]);
  });

  it("describes each tool so an agent knows when to reach for it", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

describe("without a saved report", () => {
  it("tells the agent to run verify rather than returning an empty pass", async () => {
    const result = await call("last_report");
    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toContain("Run the verify_app tool first");
    expect(bodyOf(result)).toContain("do not assume");
  });

  it("errors on list_tracked_values too", async () => {
    expect((await call("list_tracked_values")).isError).toBe(true);
  });

  it("errors on explain_value too", async () => {
    expect((await call("explain_value", { id: "revenue" })).isError).toBe(true);
  });
});

describe("with a saved report", () => {
  beforeEach(() => {
    saveVerifyResult(dir, sampleResult());
  });

  it("reports the flagged value and its reason", async () => {
    const result = await call("last_report");
    const body = bodyOf(result);
    expect(body).toContain("revenue");
    expect(body).toContain("not backed by live data");
    expect(result.structuredContent?.["confidence"]).toBe(0.5);
  });

  it("lists every tracked value with its status", async () => {
    const body = bodyOf(await call("list_tracked_values"));
    expect(body).toContain("🟢 customers — VERIFIED");
    expect(body).toContain("🟠 revenue — FALLBACK");
  });

  it("filters by status", async () => {
    const result = await call("list_tracked_values", { status: "FALLBACK" });
    const values = result.structuredContent?.["values"] as { id: string }[];
    expect(values.map((value) => value.id)).toEqual(["revenue"]);
  });

  it("explains one value with its full chain", async () => {
    const result = await call("explain_value", { id: "revenue" });
    const body = bodyOf(result);
    expect(body).toContain("FALLBACK");
    expect(body).toContain("catch block returned a hardcoded value");
    expect(result.structuredContent?.["value"]).toBe(184293);
  });

  it("names the ids it does know when asked for one it doesn't", async () => {
    const result = await call("explain_value", { id: "nope" });
    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toContain("customers, revenue");
  });

  it("surfaces the flagged values in structured content for programmatic use", async () => {
    const result = await call("last_report");
    const flagged = result.structuredContent?.["flagged"] as { id: string }[];
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.id).toBe("revenue");
  });
});

describe("verify_tests", () => {
  it("reports a real command's real evidence", async () => {
    const result = await call("verify_tests", { command: "echo hi" });
    expect(result.structuredContent?.["exitCode"]).toBe(0);
    expect(result.structuredContent?.["status"]).toBe("INCONCLUSIVE");
    expect(result.structuredContent?.["testsPassed"]).toBeNull();
  });

  it("reports a failing command honestly", async () => {
    const result = await call("verify_tests", { command: "exit 3" });
    expect(result.structuredContent?.["exitCode"]).toBe(3);
    expect(result.structuredContent?.["status"]).toBe("UNVERIFIED");
  });
});

describe("report narration", () => {
  it("says a scan that never ran is unknown, not a pass", () => {
    const result = sampleResult();
    result.provenance = {
      ran: false,
      skipped: "app unreachable",
      routesExercised: 0,
      idsFromSource: 0,
    };
    const body = describeReport(result);
    expect(body).toContain("Treat this as unknown, not as a pass");
  });

  it("flags a server-side-only scan as the weaker basis", () => {
    const result = sampleResult();
    result.provenance.basis = "inferred";
    expect(describeReport(result)).toContain("verified the server side only");
  });

  it("says so plainly when nothing is tracked", () => {
    expect(summariseValues([])).toContain("No tracked values");
  });
});
