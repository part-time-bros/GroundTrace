/**
 * The collector's storage. Deliberately dumb: it holds raw observations and
 * hands them out. All interpretation lives in `classify.ts`, so the store never
 * has an opinion about what any of it means.
 *
 * Bounded on purpose — a dev session leaves the page open for hours and this is
 * an in-memory buffer, not a database.
 */
import type { ClientNodeEvent, EventSnapshot, ServerTrace } from "./events.js";

export interface EventStoreOptions {
  maxNodes?: number;
  maxTraces?: number;
}

const DEFAULT_MAX_NODES = 500;
const DEFAULT_MAX_TRACES = 500;

export class EventStore {
  readonly #maxNodes: number;
  readonly #maxTraces: number;
  /** Latest event per tracked value id — the overlay only ever wants the current one. */
  readonly #nodes = new Map<string, ClientNodeEvent>();
  readonly #traces = new Map<string, ServerTrace>();

  constructor(options: EventStoreOptions = {}) {
    this.#maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    this.#maxTraces = options.maxTraces ?? DEFAULT_MAX_TRACES;
  }

  recordNode(event: ClientNodeEvent): void {
    // Re-inserting moves the key to the end of the Map's ordering, which keeps
    // the eviction below honestly least-recently-updated.
    this.#nodes.delete(event.id);
    this.#nodes.set(event.id, event);
    evict(this.#nodes, this.#maxNodes);
  }

  recordNodes(events: ClientNodeEvent[]): void {
    for (const event of events) this.recordNode(event);
  }

  /** Merges into an existing trace id rather than replacing it — a route may report more than once. */
  recordTrace(trace: ServerTrace): void {
    const existing = this.#traces.get(trace.traceId);
    if (existing === undefined) {
      this.#traces.set(trace.traceId, trace);
    } else {
      this.#traces.delete(trace.traceId);
      this.#traces.set(trace.traceId, {
        ...existing,
        ...trace,
        events: [...existing.events, ...trace.events],
      });
    }
    evict(this.#traces, this.#maxTraces);
  }

  node(id: string): ClientNodeEvent | undefined {
    return this.#nodes.get(id);
  }

  nodes(): ClientNodeEvent[] {
    return [...this.#nodes.values()];
  }

  trace(traceId: string): ServerTrace | undefined {
    return this.#traces.get(traceId);
  }

  traces(): ServerTrace[] {
    return [...this.#traces.values()];
  }

  snapshot(): EventSnapshot {
    return { nodes: this.nodes(), traces: this.traces() };
  }

  clear(): void {
    this.#nodes.clear();
    this.#traces.clear();
  }

  get size(): { nodes: number; traces: number } {
    return { nodes: this.#nodes.size, traces: this.#traces.size };
  }
}

function evict(map: Map<string, unknown>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) return;
    map.delete(oldest.value);
  }
}

/**
 * One store per process, stashed on `globalThis`. Next.js dev re-evaluates
 * modules on every hot reload; a plain module-level `const` would hand each
 * reloaded copy of a route its own empty store and quietly lose every event.
 */
const STORE_KEY = Symbol.for("groundtrace.store");

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: EventStore };

export function sharedStore(): EventStore {
  const scope = globalThis as GlobalWithStore;
  scope[STORE_KEY] ??= new EventStore();
  return scope[STORE_KEY];
}
