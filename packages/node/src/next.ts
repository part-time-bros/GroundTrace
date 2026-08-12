/**
 * Next.js App Router glue (Node runtime — Edge complicates the
 * `AsyncLocalStorage` propagation everything here depends on).
 *
 * Wrapping a route handler in `traceRoute` is the one line a developer adds per
 * route: it opens a trace, threads the incoming `x-groundtrace-id` through it,
 * reports what happened, and echoes the id back so the browser can join its DOM
 * values to this exact request.
 */
import { runWithTrace, newTraceId, toServerTrace, type TraceContext } from "./context.js";
import { TRACE_HEADER } from "./fetch.js";
import { reportTrace } from "./sink.js";

export interface TraceRouteOptions {
  /** Label for the trace, e.g. `"/api/revenue"`. */
  route?: string;
}

type RouteHandler<T> = (request: Request, ctx: TraceContext) => Promise<T> | T;

/** Reads the caller's trace id, or starts a new trace if there isn't one. */
export function traceIdFrom(request: Request): string {
  const header = request.headers.get(TRACE_HEADER);
  return header !== null && header !== "" ? header : newTraceId();
}

/**
 * Wraps a handler that returns plain JSON-serialisable data. The handler owns
 * its own fallback behaviour — GroundTrace only observes.
 */
export function traceRoute<T>(
  handler: RouteHandler<T>,
  options: TraceRouteOptions = {},
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const traceId = traceIdFrom(request);
    const init = options.route !== undefined ? { route: options.route } : {};

    let ctx!: TraceContext;
    try {
      const data = await runWithTrace(
        traceId,
        (traceCtx) => {
          ctx = traceCtx;
          return handler(request, traceCtx);
        },
        init,
      );
      await reportTrace(toServerTrace(ctx));
      return jsonResponse(data, 200, traceId);
    } catch (error) {
      // The handler blew up without catching. That is still evidence worth
      // keeping, so the trace is reported before the error surfaces.
      if (ctx !== undefined) await reportTrace(toServerTrace(ctx));
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500, traceId);
    }
  };
}

function jsonResponse(data: unknown, status: number, traceId: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      [TRACE_HEADER]: traceId,
    },
  });
}
