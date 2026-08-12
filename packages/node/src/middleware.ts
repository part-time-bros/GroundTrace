/**
 * Framework adapters (V2_SPEC §12).
 *
 * V1 shipped `traceRoute`, which is Next App Router shaped. Everything it does
 * is framework-agnostic underneath — open a trace from the incoming header,
 * echo the id back, report on the way out — so the same three steps are exposed
 * here for Express, Fastify, and bare `node:http`.
 *
 * Every framework type is structural. Adding Express or Fastify to
 * `dependencies` to type two function signatures would be a bad trade for
 * anyone who uses neither.
 */
import { newTraceId, runWithTrace, toServerTrace, type TraceContext } from "./context.js";
import { TRACE_HEADER } from "./fetch.js";
import { reportTrace } from "./sink.js";

/** The bits of an incoming request we need, common to every framework. */
export interface TracedRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

/** The bits of a response we need. `once` is how we know the request finished. */
export interface TracedResponse {
  setHeader(name: string, value: string): unknown;
  once(event: string, listener: () => void): unknown;
  headersSent?: boolean;
}

export function traceIdFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string {
  const raw = headers[TRACE_HEADER] ?? headers[TRACE_HEADER.toUpperCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && value !== "" ? value : newTraceId();
}

export interface MiddlewareOptions {
  /** Label for the trace. Defaults to the request path. */
  route?: (request: TracedRequest) => string | undefined;
}

/**
 * Connect/Express-style middleware.
 *
 * ```ts
 * app.use(groundtraceMiddleware());
 * ```
 *
 * The trace is reported when the response finishes rather than when the handler
 * returns — a route that streams, or that writes after an `await`, still gets
 * its full set of events.
 */
export function groundtraceMiddleware(options: MiddlewareOptions = {}) {
  return function middleware(
    request: TracedRequest,
    response: TracedResponse,
    next: () => void,
  ): void {
    const traceId = traceIdFromHeaders(request.headers);
    const route = options.route?.(request) ?? pathOf(request);

    runWithTrace(
      traceId,
      (ctx) => {
        try {
          if (response.headersSent !== true) {
            response.setHeader(TRACE_HEADER, traceId);
          }
        } catch {
          // A framework that forbids setting headers here is not worth failing over.
        }

        // Both events are needed — `finish` for a normal response, `close` for
        // a client that hangs up first — but they both fire on a normal
        // request, and the store merges same-id traces by concatenating their
        // events. Reporting twice duplicates every event in the tree.
        let reported = false;
        const report = () => {
          if (reported) return;
          reported = true;
          void reportTrace(toServerTrace(ctx));
        };

        response.once("finish", report);
        response.once("close", report);

        next();
      },
      route !== undefined ? { route } : {},
    );
  };
}

/**
 * Fastify plugin.
 *
 * ```ts
 * await app.register(groundtraceFastify);
 * ```
 *
 * Fastify's hooks can't wrap the handler in an `AsyncLocalStorage` scope the way
 * middleware can, so the trace is entered in `onRequest` and left open for the
 * lifetime of the request — which is what `runWithTrace`'s callback form does
 * here by never resolving until `onResponse`.
 */
export interface FastifyLike {
  addHook(name: string, handler: (...args: never[]) => unknown): unknown;
}

interface FastifyRequest extends TracedRequest {
  routeOptions?: { url?: string };
}

export function groundtraceFastify(
  app: FastifyLike,
  _options: unknown,
  done?: () => void,
): void {
  const contexts = new WeakMap<object, TraceContext>();

  app.addHook("onRequest", ((
    request: FastifyRequest,
    reply: { header(name: string, value: string): unknown },
    next: () => void,
  ) => {
    const traceId = traceIdFromHeaders(request.headers);
    const route = request.routeOptions?.url ?? pathOf(request);

    runWithTrace(
      traceId,
      (ctx) => {
        contexts.set(request as unknown as object, ctx);
        try {
          reply.header(TRACE_HEADER, traceId);
        } catch {
          // Same reasoning as the middleware above.
        }
        next();
      },
      route !== undefined ? { route } : {},
    );
  }) as never);

  app.addHook("onResponse", ((
    request: FastifyRequest,
    _reply: unknown,
    next: () => void,
  ) => {
    const ctx = contexts.get(request as unknown as object);
    if (ctx !== undefined) void reportTrace(toServerTrace(ctx));
    next();
  }) as never);

  done?.();
}

// Fastify only auto-skips its encapsulation for plugins marked by fastify-plugin;
// declaring it here means hooks apply to the whole app rather than a child scope.
Object.defineProperty(groundtraceFastify, Symbol.for("skip-override"), {
  value: true,
});

/**
 * Bare `node:http` wrapper, for anything with no framework at all.
 *
 * ```ts
 * http.createServer(withTracedRequest((req, res) => { ... }));
 * ```
 */
export function withTracedRequest<Req extends TracedRequest, Res extends TracedResponse>(
  handler: (request: Req, response: Res) => void | Promise<void>,
  options: MiddlewareOptions = {},
): (request: Req, response: Res) => void {
  const middleware = groundtraceMiddleware(options);
  return (request, response) => {
    middleware(request, response, () => {
      void handler(request, response);
    });
  };
}

function pathOf(request: TracedRequest): string | undefined {
  if (request.url === undefined) return undefined;
  const query = request.url.indexOf("?");
  return query === -1 ? request.url : request.url.slice(0, query);
}
