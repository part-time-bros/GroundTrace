/**
 * Vue SDK (V2_SPEC §17).
 *
 * The same three ideas as the React SDK — report a value, tag its node, join it
 * to a request — expressed in Vue's reactivity system. It shares
 * `@groundtrace/core`'s vocabulary and posts to the same collector, so the
 * overlay and the CLI work against a Vue app with no changes at all.
 *
 * The porting exercise is the point: if the client half were React-shaped
 * rather than event-shaped, this package would have needed changes in core, and
 * it didn't.
 */
import { computed, getCurrentInstance, h, onScopeDispose, watch } from "vue";
import type { ClientNodeEvent } from "@groundtrace/core";

export const TRACE_HEADER = "x-groundtrace-id";
export const NODES_PATH = "/__groundtrace/nodes";

export type NodeTransport = (events: ClientNodeEvent[]) => void | Promise<void>;

export interface ClientConfig {
  endpoint?: string;
  transport?: NodeTransport;
  enabled?: boolean;
}

let config: ClientConfig = { enabled: true };

export function configureClient(next: ClientConfig): void {
  config = { ...config, ...next };
}

export function resetClient(): void {
  pending = [];
  scheduled = undefined;
  inflight = undefined;
  config = { enabled: true };
}

let pending: ClientNodeEvent[] = [];
let scheduled: Promise<void> | undefined;
let inflight: Promise<void> | undefined;

function defaultTransport(events: ClientNodeEvent[]): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const url = new URL(NODES_PATH, config.endpoint ?? window.location.origin);
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(events),
    keepalive: true,
  }).then(
    () => undefined,
    () => undefined,
  );
}

/** Queues one tracked value; batched to a microtask, as in the React SDK. */
export function reportNode(event: ClientNodeEvent): void {
  if (config.enabled === false) return;
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
      // Reporting failures stay inside the tool.
    }
  })();

  inflight = sent;
  await sent;
  if (inflight === sent) inflight = undefined;
}

export async function whenReported(): Promise<void> {
  await scheduled;
  await flushNodes();
  await inflight;
}

/** The overlay awaits this to avoid racing a cold collector. */
function publishReady(): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>)["__groundtraceReady__"] = () =>
    whenReported();
}

export function newTraceId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `gt_${uuid}`;
}

export interface TracedResult<T> {
  data: T;
  traceId: string;
}

export async function tracedFetchJson<T>(
  input: string | URL,
  init: RequestInit = {},
): Promise<TracedResult<T>> {
  const traceId = newTraceId();
  const headers = new Headers(init.headers);
  headers.set(TRACE_HEADER, traceId);

  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  const data = (await response.json()) as T;
  return { data, traceId: response.headers.get(TRACE_HEADER) ?? traceId };
}

export interface TruthMeta {
  id: string;
  /** Human label for where this value comes from, e.g. `"/api/revenue"`. */
  source: string;
  traceId?: string | { value: string | undefined };
  transform?: string | string[];
  component?: string;
}

type MaybeRef<T> = T | { value: T };

/**
 * Marks a rendered value as tracked.
 *
 * Takes a ref, a getter, or a plain value, and reports on change rather than on
 * every re-render — Vue's `watch` gives that directly, where React needed a
 * structural key to get the same guarantee.
 */
export function useTruthValue<T>(value: MaybeRef<T> | (() => T), meta: TruthMeta): void {
  const component = meta.component ?? currentComponentName();

  // Unwrapped by hand rather than with `unref`: the input may be a getter, a
  // ref, or a plain value, and Vue's own type for `unref` doesn't cover all
  // three at once.
  const read = (): T => {
    if (typeof value === "function") return (value as () => T)();
    if (value !== null && typeof value === "object" && "value" in value) {
      return (value as { value: T }).value;
    }
    return value as T;
  };

  const source = computed(read);

  const stop = watch(
    source,
    (current) => {
      const traceId =
        typeof meta.traceId === "object" && meta.traceId !== null
          ? meta.traceId.value
          : meta.traceId;

      reportNode({
        id: meta.id,
        value: current,
        source: meta.source,
        capturedAt: Date.now(),
        ...(traceId !== undefined ? { traceId } : {}),
        ...(meta.transform !== undefined ? { transform: meta.transform } : {}),
        ...(component !== undefined ? { component } : {}),
      });
    },
    { immediate: true, deep: true },
  );

  // Only inside a component/effect scope; a bare call in a test has none.
  if (getCurrentInstance() !== null) onScopeDispose(stop);
}

function currentComponentName(): string | undefined {
  const instance = getCurrentInstance();
  if (instance === null) return undefined;
  const type = instance.type as { name?: string; __name?: string };
  return type.name ?? type.__name;
}

/**
 * Renderless component for templates: tracks the value and tags the node.
 *
 * ```vue
 * <Truth id="revenue" source="/api/revenue" :value="data.revenue">
 *   {{ formatCurrency(data.revenue) }}
 * </Truth>
 * ```
 */
export const Truth = {
  name: "Truth",
  props: {
    id: { type: String, required: true as const },
    source: { type: String, required: true as const },
    value: { type: null, required: false as const, default: undefined },
    traceId: { type: String, required: false as const, default: undefined },
    transform: { type: [String, Array], required: false as const, default: undefined },
    as: { type: String, required: false as const, default: "span" },
  },
  setup(
    props: {
      id: string;
      source: string;
      value?: unknown;
      traceId?: string;
      transform?: string | string[];
      as: string;
    },
    { slots }: { slots: Record<string, (() => unknown) | undefined> },
  ) {
    useTruthValue(() => props.value ?? slotText(slots), {
      id: props.id,
      source: props.source,
      ...(props.traceId !== undefined ? { traceId: props.traceId } : {}),
      ...(props.transform !== undefined ? { transform: props.transform } : {}),
    });

    return () =>
      h(props.as, { "data-truth-id": props.id }, slots["default"]?.() as never);
  },
};

function slotText(slots: Record<string, (() => unknown) | undefined>): unknown {
  const nodes = slots["default"]?.();
  if (!Array.isArray(nodes)) return nodes;
  const first = nodes[0] as { children?: unknown } | undefined;
  return first?.children ?? nodes;
}

export type { ClientNodeEvent } from "@groundtrace/core";
