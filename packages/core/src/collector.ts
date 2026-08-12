/**
 * The collector's request handling, expressed as a pure function.
 *
 * Deliberately transport-agnostic: the demo mounts it on a Next route handler
 * (Web `Request`/`Response`), `groundtrace run` mounts it on a `node:http`
 * server, and the tests call it directly. One set of semantics, three hosts.
 */
import { buildReport, classifyValue, type ClassifyOptions } from "./classify.js";
import type { ClientNodeEvent, ServerTrace } from "./events.js";
import type { EventStore } from "./store.js";

export const COLLECTOR_BASE = "/__groundtrace";

export interface CollectorRequest {
  method: string;
  /** Path with or without the `/__groundtrace` prefix. */
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface CollectorResponse {
  status: number;
  body: unknown;
}

export interface CollectorOptions extends ClassifyOptions {
  /** Extra ids seen in the DOM that never reported — surfaced as UNTRACED. */
  knownIds?: string[];
}

export function handleCollectorRequest(
  store: EventStore,
  request: CollectorRequest,
  options: CollectorOptions = {},
): CollectorResponse {
  const route = normalise(request.path);
  const method = request.method.toUpperCase();

  if (route === "/health") {
    return { status: 200, body: { ok: true, ...store.size } };
  }

  if (route === "/nodes" && method === "POST") {
    const events = asArray<ClientNodeEvent>(request.body);
    const valid = events.filter(isClientNodeEvent);
    store.recordNodes(valid);
    return {
      status: 202,
      body: { accepted: valid.length, rejected: events.length - valid.length },
    };
  }

  if (route === "/traces" && method === "POST") {
    const traces = asArray<ServerTrace>(request.body).filter(isServerTrace);
    for (const trace of traces) store.recordTrace(trace);
    return { status: 202, body: { accepted: traces.length } };
  }

  if (route === "/report" && method === "GET") {
    return { status: 200, body: buildReport(snapshotWith(store, options), options) };
  }

  if (route === "/value" && method === "GET") {
    const id = request.query?.["id"];
    if (id === undefined || id === "") {
      return { status: 400, body: { error: "missing required query parameter: id" } };
    }
    return { status: 200, body: classifyValue(id, store.snapshot(), options) };
  }

  if (route === "/events" && method === "GET") {
    return { status: 200, body: store.snapshot() };
  }

  if (route === "/events" && method === "DELETE") {
    store.clear();
    return { status: 200, body: { cleared: true } };
  }

  return { status: 404, body: { error: `no collector route for ${method} ${route}` } };
}

/**
 * Folds in ids that were seen in the DOM but never reported, so the report
 * counts them as UNTRACED instead of pretending they don't exist.
 */
function snapshotWith(store: EventStore, options: CollectorOptions) {
  const snapshot = store.snapshot();
  if (options.knownIds === undefined || options.knownIds.length === 0) return snapshot;

  const reported = new Set(snapshot.nodes.map((node) => node.id));
  const missing = options.knownIds
    .filter((id) => !reported.has(id))
    .map<ClientNodeEvent>((id) => ({
      id,
      value: undefined,
      source: "unknown",
      capturedAt: 0,
    }));

  return { ...snapshot, nodes: [...snapshot.nodes, ...missing] };
}

function normalise(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  const trimmed = withoutQuery.startsWith(COLLECTOR_BASE)
    ? withoutQuery.slice(COLLECTOR_BASE.length)
    : withoutQuery;
  const cleaned = trimmed.replace(/\/+$/, "");
  return cleaned === "" ? "/" : cleaned;
}

function asArray<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body === undefined || body === null) return [];
  return [body as T];
}

function isClientNodeEvent(value: unknown): value is ClientNodeEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<ClientNodeEvent>;
  return typeof event.id === "string" && typeof event.source === "string";
}

function isServerTrace(value: unknown): value is ServerTrace {
  if (typeof value !== "object" || value === null) return false;
  const trace = value as Partial<ServerTrace>;
  return typeof trace.traceId === "string" && Array.isArray(trace.events);
}
