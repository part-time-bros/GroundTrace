/**
 * The client half of the collector protocol.
 *
 * Tracked values are batched and POSTed to the local collector, where they meet
 * the server-side traces from `@groundtrace/node` (BUILD_SPEC §3 → §4). The
 * transport is swappable, which is what makes the SDK testable without a
 * network and what lets `groundtrace run` point the app at a standalone
 * collector on another port.
 */
import type { ClientNodeEvent } from "@groundtrace/core";

export const NODES_PATH = "/__groundtrace/nodes";

export type NodeTransport = (events: ClientNodeEvent[]) => void | Promise<void>;

export interface ClientConfig {
  /** Collector base URL. Defaults to the app's own origin. */
  endpoint?: string;
  transport?: NodeTransport;
  /** Turn reporting off entirely (production builds). */
  enabled?: boolean;
}

let config: Required<Pick<ClientConfig, "enabled">> & ClientConfig = {
  enabled: true,
};

export function configureClient(next: ClientConfig): void {
  config = { ...config, ...next };
}

export function clientConfig(): ClientConfig {
  return { ...config };
}

function defaultTransport(events: ClientNodeEvent[]): void {
  if (typeof window === "undefined") return;
  const url = new URL(NODES_PATH, config.endpoint ?? window.location.origin);
  const body = JSON.stringify(events);

  // `keepalive` so a value reported during a navigation still lands.
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // The collector being down must never surface in the app being observed.
  });
}

let pending: ClientNodeEvent[] = [];
let scheduled: Promise<void> | undefined;

/**
 * Queues one tracked value. Batched to a microtask so a page rendering twenty
 * tracked values makes one request, not twenty.
 */
export function reportNode(event: ClientNodeEvent): void {
  if (!config.enabled) return;
  pending = [...pending.filter((existing) => existing.id !== event.id), event];
  scheduled ??= Promise.resolve().then(flushNodes);
}

export async function flushNodes(): Promise<void> {
  scheduled = undefined;
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    await (config.transport ?? defaultTransport)(batch);
  } catch {
    // Same rule as the server sink: reporting failures stay inside the tool.
  }
}

/** Test helper — drops anything queued and any custom transport. */
export function resetClient(): void {
  pending = [];
  scheduled = undefined;
  config = { enabled: true };
}
