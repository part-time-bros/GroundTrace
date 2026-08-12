/**
 * `fetch` wrapper that records the call and propagates the trace id downstream,
 * so a chain of services shares one trace instead of starting a fresh one per
 * hop. A non-2xx response is treated as a failure — silently rendering the
 * body of a 500 is exactly the class of bug GroundTrace exists to surface.
 */
import { getTraceContext, withTrace, type TraceOptions } from "./context.js";

export const TRACE_HEADER = "x-groundtrace-id";

export class TracedHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, statusText: string, url: string) {
    super(`${status} ${statusText} from ${url}`);
    this.name = "TracedHttpError";
    this.status = status;
    this.url = url;
  }
}

export type TracedFetchOptions = Omit<TraceOptions, "kind"> & {
  /** Treat a non-2xx response as a failure. Defaults to true. */
  throwOnHttpError?: boolean;
};

export async function tracedFetch(
  sourceId: string,
  input: string | URL,
  init: RequestInit = {},
  options: TracedFetchOptions = {},
): Promise<Response> {
  const traceId = getTraceContext()?.traceId;
  const headers = new Headers(init.headers);
  if (traceId !== undefined && !headers.has(TRACE_HEADER)) {
    headers.set(TRACE_HEADER, traceId);
  }

  const { throwOnHttpError = true, ...traceOptions } = options;

  return withTrace(
    sourceId,
    async () => {
      const response = await fetch(input, { ...init, headers });
      if (throwOnHttpError && !response.ok) {
        throw new TracedHttpError(response.status, response.statusText, String(input));
      }
      return response;
    },
    {
      ...traceOptions,
      kind: "fetch",
      label: traceOptions.label ?? `GET ${String(input)}`,
    },
  );
}

/** `tracedFetch` + `.json()`, since that is what every caller does next. */
export async function tracedFetchJson<T>(
  sourceId: string,
  input: string | URL,
  init: RequestInit = {},
  options: TracedFetchOptions = {},
): Promise<T> {
  const response = await tracedFetch(sourceId, input, init, options);
  return (await response.json()) as T;
}
