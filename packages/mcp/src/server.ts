/**
 * GroundTrace as MCP tools (V2_SPEC §11).
 *
 * V1 delivered "don't trust the agent's 'Done ✅'" as a terminal report a human
 * reads. That only helps after the fact. Exposed as MCP tools, the same
 * evidence becomes something the agent can query *mid-task* — it can check
 * whether the number it just wired up is real before it claims to be finished.
 *
 * Every tool returns the same plain-English `reason` strings the CLI prints. An
 * agent handed "confidence 67%" with no explanation is exactly the opacity this
 * project exists to remove.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { STATUS_LIGHT, renderTree, type ValueProvenance } from "@groundtrace/core";
import {
  formatEvidence,
  formatVerify,
  loadVerifyResult,
  runVerify,
  saveVerifyResult,
  statusOf,
  verifyTests,
  type VerifyResult,
} from "groundtrace";

export const SERVER_NAME = "groundtrace";
export const SERVER_VERSION = "0.1.0";

export interface GroundTraceMcpOptions {
  /** Project directory the tools operate on. Defaults to the process cwd. */
  cwd?: string;
}

interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  // The SDK's result type carries an index signature for protocol extensions.
  [key: string]: unknown;
}

function text(body: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: body }],
    ...(structured !== undefined ? { structuredContent: structured } : {}),
  };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** One-line summary per value, in the same vocabulary as the overlay. */
export function summariseValues(values: ValueProvenance[]): string {
  if (values.length === 0) return "No tracked values were found.";
  return values
    .map(
      (value) =>
        `${STATUS_LIGHT[value.status]} ${value.id} — ${value.status}: ${value.reason}`,
    )
    .join("\n");
}

export function describeReport(result: VerifyResult): string {
  const report = result.provenance.report;
  const lines = [formatVerify(result)];

  if (report !== undefined && report.values.length > 0) {
    lines.push("", summariseValues(report.values));
  }

  if (!result.provenance.ran) {
    lines.push(
      "",
      "The provenance scan did not run, so no confidence figure is available. " +
        "Treat this as unknown, not as a pass.",
    );
  } else if (result.provenance.basis === "inferred") {
    lines.push(
      "",
      "This scan verified the server side only — no browser rendered the page, so " +
        "displayed values were not compared against their sources.",
    );
  }

  return lines.join("\n");
}

export function createServer(options: GroundTraceMcpOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "GroundTrace reports where the values a web app displays actually came from. " +
        "Use verify_app before telling a user a UI change works: it distinguishes a " +
        "number backed by a real query from one a catch block substituted. " +
        "Statuses are VERIFIED, INDIRECT, FALLBACK, SYNTHETIC, UNTRACED.",
    },
  );

  server.registerTool(
    "verify_app",
    {
      title: "Verify the app's displayed values",
      description:
        "Builds, tests, and traces the app, then reports how many displayed values are " +
        "backed by real sources. Use this instead of assuming a UI change worked.",
      inputSchema: {
        skipBuild: z.boolean().optional().describe("Skip the build step (faster)."),
        skipTests: z.boolean().optional().describe("Skip the test step (faster)."),
        noBrowser: z
          .boolean()
          .optional()
          .describe("Skip the real-DOM scan; verifies the server side only."),
        url: z
          .string()
          .optional()
          .describe(
            "Base URL of an already-running app to scan instead of starting one.",
          ),
      },
    },
    async (args) => {
      try {
        const result = await runVerify({
          cwd,
          quiet: true,
          skipBuild: args.skipBuild ?? false,
          skipTests: args.skipTests ?? false,
          noBrowser: args.noBrowser ?? false,
          ...(args.url !== undefined ? { appUrl: args.url } : {}),
        });
        saveVerifyResult(cwd, result);
        return text(describeReport(result), toStructured(result));
      } catch (error) {
        return failure(`verify failed: ${messageOf(error)}`);
      }
    },
  );

  server.registerTool(
    "list_tracked_values",
    {
      title: "List tracked values",
      description:
        "Every value the last verify run tracked, with its classification and the " +
        "evidence behind it. Reads the saved report; does not re-run anything.",
      inputSchema: {
        status: z
          .enum(["VERIFIED", "INDIRECT", "FALLBACK", "SYNTHETIC", "UNTRACED"])
          .optional()
          .describe("Only return values with this classification."),
      },
    },
    (args) => {
      const result = loadVerifyResult(cwd);
      if (result === undefined) return failure(NO_REPORT);

      const all = result.provenance.report?.values ?? [];
      const values =
        args.status === undefined
          ? all
          : all.filter((value) => value.status === args.status);

      return text(summariseValues(values), {
        values: values.map((value) => ({
          id: value.id,
          status: value.status,
          reason: value.reason,
          source: value.source,
        })),
      });
    },
  );

  server.registerTool(
    "explain_value",
    {
      title: "Explain one value's provenance",
      description:
        "The full component → state → API → database chain for a single displayed value, " +
        "showing exactly where it came from.",
      inputSchema: {
        id: z.string().describe('The tracked value id, e.g. "revenue".'),
      },
    },
    (args) => {
      const result = loadVerifyResult(cwd);
      if (result === undefined) return failure(NO_REPORT);

      const values = result.provenance.report?.values ?? [];
      const value = values.find((candidate) => candidate.id === args.id);
      if (value === undefined) {
        const known = values.map((candidate) => candidate.id).join(", ");
        return failure(
          known === ""
            ? `No tracked values in the last report.`
            : `No tracked value "${args.id}". Known ids: ${known}`,
        );
      }

      const body = [
        `${STATUS_LIGHT[value.status]} ${value.id} — ${value.status}`,
        "",
        ...renderTree(value.tree),
        "",
        value.reason,
      ].join("\n");

      return text(body, {
        id: value.id,
        status: value.status,
        reason: value.reason,
        value: value.value ?? null,
        source: value.source,
      });
    },
  );

  server.registerTool(
    "verify_tests",
    {
      title: "Verify a test claim",
      description:
        "Runs a test command and reports what actually happened — exit code and real " +
        "pass/fail counts. Use this rather than asserting that tests pass.",
      inputSchema: {
        command: z.string().describe('The test command to run, e.g. "pytest -q".'),
      },
    },
    (args) => {
      try {
        const evidence = verifyTests(args.command);
        const status = statusOf(evidence);
        const body = [
          formatEvidence(evidence),
          "",
          evidence.raw.trim() === "" ? "" : `Output tail:\n${evidence.raw.trimEnd()}`,
        ]
          .filter((part) => part !== "")
          .join("\n");

        return text(body, {
          status,
          command: evidence.command,
          exitCode: evidence.exitCode,
          testsPassed: evidence.testsPassed,
          testsFailed: evidence.testsFailed,
          testsDiscovered: evidence.testsDiscovered,
        });
      } catch (error) {
        return failure(`could not run the test command: ${messageOf(error)}`);
      }
    },
  );

  server.registerTool(
    "last_report",
    {
      title: "Read the last verify report",
      description: "The most recent verify result, without re-running anything.",
      inputSchema: {},
    },
    () => {
      const result = loadVerifyResult(cwd);
      if (result === undefined) return failure(NO_REPORT);
      return text(describeReport(result), toStructured(result));
    },
  );

  return server;
}

const NO_REPORT =
  "No saved GroundTrace report. Run the verify_app tool first — do not assume the " +
  "app's values are correct without it.";

function toStructured(result: VerifyResult): Record<string, unknown> {
  const report = result.provenance.report;
  return {
    ran: result.provenance.ran,
    basis: result.provenance.basis ?? null,
    confidence: report?.confidence ?? null,
    tracked: report?.tracked ?? 0,
    counts: report?.counts ?? {},
    buildExitCode: result.build.ran ? result.build.exitCode : null,
    testsPassed: result.tests.testsPassed,
    flagged: (report?.values ?? [])
      .filter((value) => value.status !== "VERIFIED" && value.status !== "INDIRECT")
      .map((value) => ({ id: value.id, status: value.status, reason: value.reason })),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
