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
let inflight: Promise<void> | undefined;

/**
 * Global handshake for the overlay.
 *
 * Without it there is a real cold-start race: on the first load of a fresh dev
 * server the collector route still has to compile (~1s under Turbopack), so a
 * click that lands first queries before any client event has arrived and the
 * overlay honestly — but uselessly — reports UNTRACED. The overlay awaits this
 * when it is present, so it asks only once the reports are in.
 */
const READY_KEY = "__groundtraceReady__";

function publishReady(): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>)[READY_KEY] = () => whenReported();
}

/**
 * Queues one tracked value. Batched to a microtask so a page rendering twenty
 * tracked values makes one request, not twenty.
 */
export function reportNode(event: ClientNodeEvent): void {
  if (!config.enabled) return;
  publishReady();
  pending = [...pending.filter((existing) => existing.id !== event.id), event];
  scheduled ??= Promise.resolve().then(flushNodes);
}

export async function flushNodes(): Promise<void> {
  scheduled = undefined;
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];

  const sent = (async () => {
    try {
      await (config.transport ?? defaultTransport)(batch);
    } catch {
      // Same rule as the server sink: reporting failures stay inside the tool.
    }
  })();

  inflight = sent;
  await sent;
  if (inflight === sent) inflight = undefined;
}

/** Resolves once every queued and in-flight report has been delivered. */
export async function whenReported(): Promise<void> {
  await scheduled;
  await flushNodes();
  await inflight;
}

/** Test helper — drops anything queued and any custom transport. */
export function resetClient(): void {
  pending = [];
  scheduled = undefined;
  inflight = undefined;
  config = { enabled: true };
}
