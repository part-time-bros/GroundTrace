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
import { sharedStore, type ServerTrace } from "@groundtrace/core";

export interface CollectorConfig {
  /** Base URL of a standalone collector, e.g. `http://127.0.0.1:7777`. */
  url?: string;
  /** Also keep traces in this process's store. Defaults to true. */
  local?: boolean;
}

let config: CollectorConfig = {
  ...(process.env["GROUNDTRACE_COLLECTOR_URL"] !== undefined
    ? { url: process.env["GROUNDTRACE_COLLECTOR_URL"] }
    : {}),
  local: true,
};

export function configureCollector(next: CollectorConfig): void {
  config = { ...config, ...next };
}

export function collectorConfig(): CollectorConfig {
  return { ...config };
}

export const TRACES_PATH = "/__groundtrace/traces";

/** Records a finished trace. Never throws, never rejects. */
export async function reportTrace(trace: ServerTrace): Promise<void> {
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
