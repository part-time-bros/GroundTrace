/**
 * React Server Component support.
 *
 * V1 and V2 both assumed the shape the demo used: a client component fetches an
 * API route, the browser sets `x-groundtrace-id`, and the route opens a trace
 * from it. A large share of modern Next apps don't do that — they query the
 * database *directly inside a server component*, with no API route, no client
 * fetch, and therefore no header to correlate on. Those apps were invisible to
 * GroundTrace, which is a bad hole for a tool that claims to trace any displayed
 * value.
 *
 * The fix is small: a server render is just another request-scoped unit of work.
 * `traceServerRender` opens a trace around it, mints the id itself (no caller to
 * receive one from), reports what happened, and hands the id back so client
 * components rendered from the same page can join to it.
 */
import { newTraceId, runWithTrace, toServerTrace, type TraceContext } from "./context.js";
import { reportTrace } from "./sink.js";

export interface ServerRenderResult<T> {
  data: T;
  /** Pass to `<TraceScope traceId={...}>` so client values join this render. */
  traceId: string;
}

export interface TraceServerRenderOptions {
  /** Label for the trace, e.g. `"/dashboard"`. */
  route?: string;
  /**
   * Reuse an id instead of minting one — for a nested render that belongs to a
   * trace already open further up the tree.
   */
  traceId?: string;
}

/**
 * Traces a server component's data fetching.
 *
 * ```tsx
 * export default async function Page() {
 *   const { data, traceId } = await traceServerRender(
 *     () => instrumentedGet(db, "revenue-query", REVENUE_SQL, [], {
 *       produces: ["revenue"],
 *       extract: (row) => row as Record<string, unknown>,
 *     }),
 *     { route: "/dashboard" },
 *   );
 *
 *   return (
 *     <TraceScope traceId={traceId}>
 *       <Metric id="revenue" value={data.revenue} />
 *     </TraceScope>
 *   );
 * }
 * ```
 *
 * The trace is reported whether the body succeeds or throws — a server render
 * that failed and fell back is exactly the case worth recording.
 */
export async function traceServerRender<T>(
  fn: (ctx: TraceContext) => Promise<T> | T,
  options: TraceServerRenderOptions = {},
): Promise<ServerRenderResult<T>> {
  const traceId = options.traceId ?? newTraceId();
  const init = options.route !== undefined ? { route: options.route } : {};

  let ctx!: TraceContext;
  try {
    const data = await runWithTrace(
      traceId,
      (traceCtx) => {
        ctx = traceCtx;
        return fn(traceCtx);
      },
      init,
    );
    await reportTrace(toServerTrace(ctx));
    return { data, traceId };
  } catch (error) {
    if (ctx !== undefined) await reportTrace(toServerTrace(ctx));
    throw error;
  }
}

/**
 * Reads an inbound trace id from Next's `headers()`, when there is one.
 *
 * A plain page navigation has no GroundTrace header, so this is usually
 * `undefined` and `traceServerRender` mints its own. It matters for a server
 * component reached from a client-side fetch that *did* set one — reusing the
 * caller's id keeps both halves in a single trace instead of splitting them.
 */
export function traceIdFromNextHeaders(
  headers: { get(name: string): string | null } | undefined,
): string | undefined {
  const value = headers?.get("x-groundtrace-id");
  return value !== null && value !== undefined && value !== "" ? value : undefined;
}
