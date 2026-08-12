/**
 * Where finished server traces go.
 *
 * Two deployments, one code path:
 *   - the demo hosts the collector inside its own Next server, so traces land
 *     in the shared in-process store and the overlay reads them from there;
 *   - `groundtrace run` against someone else's app runs the collector as a
 *     separate process, so traces are POSTed to `GROUNDTRACE_COLLECTOR_URL`.
 *
 * Reporting is always best-effort. A dev-mode observability tool that can break
 * a request by failing to phone home has failed at its one job.
 */
import {
  applySafetyToValues,
  isSampled,
  resolveSafety,
  sharedStore,
  type ResolvedSafety,
  type SafetyOptions,
  type ServerTrace,
} from "@groundtrace/core";

export interface CollectorConfig extends SafetyOptions {
  /** Base URL of a standalone collector, e.g. `http://127.0.0.1:7777`. */
  url?: string;
  /** Also keep traces in this process's store. Defaults to true. */
  local?: boolean;
}

function envMode(): SafetyOptions["mode"] {
  const explicit = process.env["GROUNDTRACE_MODE"];
  if (explicit === "dev" || explicit === "production" || explicit === "off") {
    return explicit;
  }
  // NODE_ENV=production means production rules — which, by default, means off.
  return process.env["NODE_ENV"] === "production" ? "production" : "dev";
}

let config: CollectorConfig = {
  ...(process.env["GROUNDTRACE_COLLECTOR_URL"] !== undefined
    ? { url: process.env["GROUNDTRACE_COLLECTOR_URL"] }
    : {}),
  local: true,
  mode: envMode(),
  ...(process.env["GROUNDTRACE_SAMPLE_RATE"] !== undefined
    ? { sampleRate: Number(process.env["GROUNDTRACE_SAMPLE_RATE"]) }
    : {}),
};

export function configureCollector(next: CollectorConfig): void {
  config = { ...config, ...next };
}

export function collectorConfig(): CollectorConfig {
  return { ...config };
}

export const TRACES_PATH = "/__groundtrace/traces";

/** The effective safety policy, after env and explicit configuration. */
export function safety(): ResolvedSafety {
  return resolveSafety(config);
}

/** Applies the safety policy to a trace before it leaves the process. */
export function prepareTrace(
  trace: ServerTrace,
  resolved: ResolvedSafety,
): ServerTrace | undefined {
  if (!resolved.enabled) return undefined;
  if (!isSampled(trace.traceId, resolved.sampleRate)) return undefined;
  if (!resolved.redact) return trace;

  return {
    ...trace,
    events: trace.events.map((event) =>
      event.values === undefined
        ? event
        : { ...event, values: applySafetyToValues(event.values, resolved) },
    ),
  };
}

/** Records a finished trace. Never throws, never rejects. */
export async function reportTrace(rawTrace: ServerTrace): Promise<void> {
  const trace = prepareTrace(rawTrace, safety());
  if (trace === undefined) return;

  if (config.local !== false) {
    try {
      sharedStore().recordTrace(trace);
    } catch {
      // Storage is a nice-to-have; the request it belongs to is not.
    }
  }

  if (config.url === undefined || config.url === "") return;

  try {
    await fetch(new URL(TRACES_PATH, config.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(trace),
    });
  } catch {
    // Collector down, wrong port, dev server restarting — none of that is the
    // traced request's problem.
  }
}
