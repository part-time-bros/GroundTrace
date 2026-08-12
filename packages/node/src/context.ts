/**
 * Request-scoped provenance tracking.
 *
 * `AsyncLocalStorage` is the whole reason this is safe under concurrency: a
 * module-level `let currentTrace` would work fine in a test and then silently
 * cross-contaminate two in-flight requests in the demo. The isolation is the
 * feature, so it is tested explicitly (see `context.test.ts`).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ServerTrace, TraceEvent, TraceEventKind } from "@groundtrace/core";

export interface TraceContext {
  traceId: string;
  route?: string;
  startedAt: number;
  events: TraceEvent[];
}

const storage = new AsyncLocalStorage<TraceContext>();

export function newTraceId(): string {
  return `gt_${randomUUID()}`;
}

export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

export interface TraceInit {
  route?: string;
}

/**
 * Runs `fn` with a fresh trace context bound to it. The context is handed to
 * `fn` as well as being available via `getTraceContext()`, so a route handler
 * can read its own events back out without a second lookup.
 */
export function runWithTrace<T>(
  traceId: string,
  fn: (ctx: TraceContext) => T,
  init: TraceInit = {},
): T {
  const ctx: TraceContext = {
    traceId,
    startedAt: Date.now(),
    events: [],
    ...(init.route !== undefined ? { route: init.route } : {}),
  };
  return storage.run(ctx, () => fn(ctx));
}

/** Freezes a context into the serialisable shape the collector stores. */
export function toServerTrace(ctx: TraceContext): ServerTrace {
  return {
    traceId: ctx.traceId,
    ...(ctx.route !== undefined ? { route: ctx.route } : {}),
    startedAt: ctx.startedAt,
    endedAt: Date.now(),
    events: [...ctx.events],
  };
}

/**
 * Records an event against the current trace. Outside a `runWithTrace` scope
 * this is a no-op: instrumentation that crashes an un-instrumented code path
 * would be worse than instrumentation that records nothing.
 */
export function recordEvent(event: TraceEvent): void {
  getTraceContext()?.events.push(event);
}

export interface TraceOptions {
  kind?: TraceEventKind;
  label?: string;
  /** Tracked value ids this call feeds — the join to the client's DOM nodes. */
  produces?: string[];
  /**
   * Pulls the produced values out of the result so the classifier can prove the
   * displayed number matches the source's number rather than assuming it.
   */
  extract?: (result: unknown) => Record<string, unknown>;
}

function baseEvent(
  sourceId: string,
  options: TraceOptions,
  startedAt: number,
): Omit<TraceEvent, "status"> {
  return {
    sourceId,
    timestamp: Date.now(),
    durationMs: Date.now() - startedAt,
    ...(options.kind !== undefined ? { kind: options.kind } : {}),
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.produces !== undefined ? { produces: options.produces } : {}),
  };
}

function safeExtract(
  options: TraceOptions,
  result: unknown,
): Record<string, unknown> | undefined {
  if (options.extract === undefined) return undefined;
  try {
    return options.extract(result);
  } catch {
    // An extractor that throws must not turn a healthy call into a fallback.
    return undefined;
  }
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wraps an async call. On success the call is recorded VERIFIED; on failure it
 * is recorded FALLBACK_TRIGGERED and the error is **re-thrown** — the caller's
 * own catch block decides what the fallback value is, and that assignment stays
 * a separate, deliberately visible step (see the demo in BUILD_SPEC §6).
 */
export async function withTrace<T>(
  sourceId: string,
  fn: () => Promise<T> | T,
  options: TraceOptions = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const values = safeExtract(options, result);
    recordEvent({
      ...baseEvent(sourceId, options, startedAt),
      status: "VERIFIED",
      ...(values !== undefined ? { values } : {}),
    });
    return result;
  } catch (err) {
    recordEvent({
      ...baseEvent(sourceId, options, startedAt),
      status: "FALLBACK_TRIGGERED",
      detail: errorDetail(err),
    });
    throw err;
  }
}

/** The synchronous twin of `withTrace`, for sync sources like better-sqlite3. */
export function withTraceSync<T>(
  sourceId: string,
  fn: () => T,
  options: TraceOptions = {},
): T {
  const startedAt = Date.now();
  try {
    const result = fn();
    const values = safeExtract(options, result);
    recordEvent({
      ...baseEvent(sourceId, options, startedAt),
      status: "VERIFIED",
      ...(values !== undefined ? { values } : {}),
    });
    return result;
  } catch (err) {
    recordEvent({
      ...baseEvent(sourceId, options, startedAt),
      status: "FALLBACK_TRIGGERED",
      detail: errorDetail(err),
    });
    throw err;
  }
}

/**
 * Records the fallback value a catch block actually returned. Optional — the
 * FALLBACK classification already fires off the failed call — but it makes the
 * overlay able to show *what* was substituted, not just that something was.
 */
export function recordFallbackValue(
  sourceId: string,
  values: Record<string, unknown>,
  detail?: string,
): void {
  recordEvent({
    sourceId,
    status: "FALLBACK_TRIGGERED",
    timestamp: Date.now(),
    kind: "compute",
    label: "catch block returned a hardcoded value",
    produces: Object.keys(values),
    values,
    ...(detail !== undefined ? { detail } : {}),
  });
}
