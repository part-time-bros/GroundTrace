/**
 * `groundtrace verify` — build + tests + a provenance scan, as one report.
 *
 * The rule this command lives by: it reports what it actually observed. If the
 * app couldn't be reached, it says the provenance scan didn't run rather than
 * printing a confident-looking 100%. A verification tool that guesses is worse
 * than no verification tool, because you'd believe it.
 */
import { spawnSync } from "node:child_process";
import {
  EventStore,
  STATUS_LIGHT,
  buildReport,
  type ClientNodeEvent,
  type ProvenanceReport,
  type ServerTrace,
} from "@groundtrace/core";
import { startApp, waitForApp } from "../app-process.js";
import { loadConfig, type GroundTraceConfig } from "../config.js";
import { scanProject } from "../scan.js";
import { startCollectorServer } from "../server.js";
import { box, cross, paint, tick, unknown } from "../ui.js";
import { statusOf, verifyTests, type TestEvidence } from "./verify-tests.js";

export interface BuildEvidence {
  command: string;
  ran: boolean;
  exitCode: number;
  tail: string;
}

export interface ProvenanceEvidence {
  ran: boolean;
  /** Why it didn't run, when it didn't. */
  skipped?: string;
  report?: ProvenanceReport;
  routesExercised: number;
  idsFromSource: number;
}

export interface VerifyResult {
  build: BuildEvidence;
  tests: TestEvidence;
  provenance: ProvenanceEvidence;
  generatedAt: number;
}

export interface VerifyOptions {
  cwd: string;
  quiet?: boolean;
  /** Skip the build step (it is the slowest, and not always what you're checking). */
  skipBuild?: boolean;
  skipTests?: boolean;
  /** Already-running app to scan instead of starting one. */
  appUrl?: string;
  configOverrides?: Partial<GroundTraceConfig>;
}

export async function runVerify(options: VerifyOptions): Promise<VerifyResult> {
  const config = { ...loadConfig(options.cwd), ...options.configOverrides };

  const build = options.skipBuild
    ? { command: config.build, ran: false, exitCode: -1, tail: "" }
    : runBuild(config.build, options.cwd);

  const tests = options.skipTests
    ? emptyTestEvidence(config.test)
    : verifyTests(withCwd(config.test, options.cwd));

  const provenance = await scanProvenance(config, options);

  return { build, tests, provenance, generatedAt: Date.now() };
}

function withCwd(command: string, cwd: string): string {
  return `cd ${JSON.stringify(cwd)} && ${command}`;
}

function runBuild(command: string, cwd: string): BuildEvidence {
  const result = spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  return {
    command,
    ran: result.error === undefined && result.status !== null,
    exitCode: result.status ?? -1,
    tail: combined.slice(-2_000),
  };
}

function emptyTestEvidence(command: string): TestEvidence {
  return {
    command,
    exitCode: -1,
    executed: false,
    runner: "unknown",
    testsDiscovered: null,
    testsPassed: null,
    testsFailed: null,
    raw: "",
  };
}

/**
 * Exercises the app's routes and classifies every tracked value it can find.
 *
 * Headless, so there is no DOM to read: the client half of each value is
 * reconstructed from the ids declared in the source, and only ever carries the
 * id — never a made-up value. That is enough to answer the question `verify`
 * asks ("is anything on this page fed by a failed source?") without inventing
 * evidence it doesn't have.
 */
async function scanProvenance(
  config: GroundTraceConfig,
  options: VerifyOptions,
): Promise<ProvenanceEvidence> {
  const scan = scanProject(options.cwd, config.scan);

  const collector = await startCollectorServer({ port: 0, store: new EventStore() });
  let app: ReturnType<typeof startApp> | undefined;

  try {
    const appUrl = options.appUrl ?? `http://127.0.0.1:${config.appPort}`;

    let reachable = await waitForApp(appUrl, 2_000);
    if (!reachable && options.appUrl === undefined) {
      app = startApp({
        command: config.dev,
        cwd: options.cwd,
        inherit: false,
        env: {
          GROUNDTRACE_COLLECTOR_URL: collector.url,
          PORT: String(config.appPort),
        },
      });
      reachable = await waitForApp(appUrl, 90_000);
    }

    if (!reachable) {
      return {
        ran: false,
        skipped: `the app never became reachable at ${appUrl}${appStartupHint(app)}`,
        routesExercised: 0,
        idsFromSource: scan.trackedIds.length,
      };
    }

    const traceIds = await exerciseRoutes(appUrl, config.routes);

    // Traces reach us either through the collector we just started (the app is
    // configured to POST to it) or, for an app hosting its own collector, from
    // that collector's snapshot.
    const traces = dedupeTraces([
      ...collector.store.traces(),
      ...(await fetchRemoteTraces(appUrl)),
    ]);

    // Two sources of tracked ids, and the runtime one is the stronger:
    // instrumented code states outright which values each source `produces`,
    // where the static scan can only find ids written as string literals (the
    // demo passes them as JSX expressions, so a scan alone finds nothing).
    const ids = [...new Set([...producedIds(traces), ...scan.trackedIds])].sort();

    const nodes = syntheticNodes(ids, traces, traceIds);
    const report = buildReport(
      { nodes, traces },
      { knownLiterals: scan.fallbackLiterals },
    );

    return {
      ran: true,
      report,
      routesExercised: traceIds.length,
      idsFromSource: scan.trackedIds.length,
    };
  } finally {
    await app?.stop();
    await collector.close();
  }
}

/** The app's own last words, which usually say exactly what went wrong. */
function appStartupHint(app: ReturnType<typeof startApp> | undefined): string {
  const output = app?.output().trim();
  if (output === undefined || output === "") return "";
  const lastLines = output.split("\n").slice(-3).join(" ").trim();
  return lastLines === "" ? "" : ` — it said: ${lastLines}`;
}

async function exerciseRoutes(appUrl: string, routes: string[]): Promise<string[]> {
  const traceIds: string[] = [];

  for (const route of routes) {
    const traceId = `gt_verify_${Math.random().toString(36).slice(2, 10)}`;
    try {
      await fetch(new URL(route, appUrl), {
        headers: { "x-groundtrace-id": traceId },
        signal: AbortSignal.timeout(20_000),
      });
      traceIds.push(traceId);
    } catch {
      // A route that can't be reached is not evidence of anything; skip it.
    }
  }

  return traceIds;
}

/** Apps that host their own collector (like the reference demo) expose it here. */
async function fetchRemoteTraces(appUrl: string): Promise<ServerTrace[]> {
  try {
    const response = await fetch(new URL("/__groundtrace/events", appUrl), {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const snapshot = (await response.json()) as { traces?: ServerTrace[] };
    return snapshot.traces ?? [];
  } catch {
    return [];
  }
}

/**
 * The same trace usually arrives twice — once because the app POSTed it to the
 * collector we started, and once from the app's own collector snapshot. Left
 * alone, that renders every source node in the provenance tree twice.
 */
export function dedupeTraces(traces: ServerTrace[]): ServerTrace[] {
  const byId = new Map<string, ServerTrace>();

  for (const trace of traces) {
    const existing = byId.get(trace.traceId);
    if (existing === undefined) {
      byId.set(trace.traceId, trace);
      continue;
    }

    const seen = new Set(existing.events.map(eventKey));
    byId.set(trace.traceId, {
      ...existing,
      events: [
        ...existing.events,
        ...trace.events.filter((event) => !seen.has(eventKey(event))),
      ],
    });
  }

  return [...byId.values()];
}

function eventKey(event: ServerTrace["events"][number]): string {
  return [event.sourceId, event.status, event.timestamp, event.detail ?? ""].join("|");
}

/** Every value id the instrumented server code claimed to produce. */
export function producedIds(traces: ServerTrace[]): string[] {
  const ids = new Set<string>();
  for (const trace of traces) {
    for (const event of trace.events) {
      for (const id of event.produces ?? []) ids.add(id);
      for (const id of Object.keys(event.values ?? {})) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * One client-side stand-in per declared id, carrying the id and (where we can
 * work it out) the trace that produced it. Never a value — we didn't see one.
 */
function syntheticNodes(
  ids: string[],
  traces: ServerTrace[],
  traceIds: string[],
): ClientNodeEvent[] {
  return ids.map((id) => {
    const owning = traces.find((trace) =>
      trace.events.some(
        (event) => event.produces?.includes(id) === true || event.sourceId === id,
      ),
    );
    const traceId = owning?.traceId ?? traceIds[0];

    return {
      id,
      value: undefined,
      valueObserved: false,
      source: owning?.route ?? "unknown",
      capturedAt: Date.now(),
      ...(traceId !== undefined ? { traceId } : {}),
    };
  });
}

// ---------------------------------------------------------------------------

export function formatVerify(result: VerifyResult): string {
  const lines: string[] = [];

  lines.push(`Build            ${buildMark(result.build)}`);
  lines.push(`Tests            ${testMark(result.tests)}`);

  const { provenance } = result;
  if (!provenance.ran || provenance.report === undefined) {
    lines.push(
      `Tracked values   ${unknown(`not scanned — ${provenance.skipped ?? "unavailable"}`)}`,
    );
    lines.push(`Confidence       ${paint("unknown", "yellow")}`);
    return box("GROUNDTRACE VERIFICATION", lines, 29);
  }

  const report = provenance.report;
  lines.push(`Tracked values   ${report.tracked}`);

  for (const status of [
    "VERIFIED",
    "INDIRECT",
    "FALLBACK",
    "SYNTHETIC",
    "UNTRACED",
  ] as const) {
    const count = report.counts[status];
    if (count === 0) continue;
    const label = `${status[0]}${status.slice(1).toLowerCase()}`.padEnd(12);
    const flagged = report.values.filter((value) => value.status === status);
    const suffix =
      status === "VERIFIED" || status === "INDIRECT"
        ? ""
        : `  ⚠ ${flagged.map((value) => value.id).join(", ")} (see: groundtrace report --id ${flagged[0]?.id ?? ""})`;
    lines.push(`  ${label} ${count}${suffix}`);
  }

  lines.push(`Confidence       ${confidenceLabel(report)}`);
  return box("GROUNDTRACE VERIFICATION", lines, 29);
}

function confidenceLabel(report: ProvenanceReport): string {
  if (report.confidence === null) return paint("n/a (nothing tracked)", "yellow");
  const percent = Math.round(report.confidence * 100);
  const ink = percent === 100 ? "green" : percent >= 50 ? "yellow" : "red";
  return paint(`${percent}%`, ink);
}

function buildMark(build: BuildEvidence): string {
  if (!build.ran) return unknown("skipped");
  return build.exitCode === 0 ? tick("") : cross(`exit code ${build.exitCode}`);
}

function testMark(tests: TestEvidence): string {
  if (!tests.executed) return unknown("skipped");
  const status = statusOf(tests);
  const counts =
    tests.testsPassed !== null && tests.testsDiscovered !== null
      ? `  (${tests.testsPassed}/${tests.testsDiscovered}, see verify-tests log)`
      : "  (no counts in output)";
  return status === "VERIFIED" ? `${tick("")}${counts}` : `${cross(status)}${counts}`;
}

/** Non-zero when anything verifiable came back short. */
export function verifyExitCode(result: VerifyResult): number {
  if (result.build.ran && result.build.exitCode !== 0) return 1;
  if (result.tests.executed && statusOf(result.tests) === "UNVERIFIED") return 1;
  const confidence = result.provenance.report?.confidence;
  if (confidence !== undefined && confidence !== null && confidence < 1) return 1;
  return 0;
}

export function formatFlagged(result: VerifyResult): string[] {
  const report = result.provenance.report;
  if (report === undefined) return [];
  return report.values
    .filter((value) => value.status !== "VERIFIED" && value.status !== "INDIRECT")
    .map((value) => `${STATUS_LIGHT[value.status]} ${value.id} — ${value.reason}`);
}
