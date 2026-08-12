"use client";

/**
 * The browser side of trace correlation: mint an id, send it with the request,
 * and hand it back so every value rendered from the response can be joined to
 * the exact request that produced it.
 */
import { useCallback, useEffect, useState } from "react";

export const TRACE_HEADER = "x-groundtrace-id";

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
  // The server echoes the id back; trust its copy in case a proxy rewrote ours.
  return { data, traceId: response.headers.get(TRACE_HEADER) ?? traceId };
}

export interface TracedQueryState<T> {
  data: T | undefined;
  traceId: string | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

/** Minimal fetch-on-mount hook. GroundTrace's demo needs a query, not a query library. */
export function useTracedQuery<T>(
  url: string,
  deps: unknown[] = [],
): TracedQueryState<T> {
  const [state, setState] = useState<{
    data: T | undefined;
    traceId: string | undefined;
    error: Error | undefined;
    loading: boolean;
  }>({ data: undefined, traceId: undefined, error: undefined, loading: true });
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));

    tracedFetchJson<T>(url)
      .then(({ data, traceId }) => {
        if (cancelled) return;
        setState({ data, traceId, error: undefined, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: undefined,
          traceId: undefined,
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce, ...deps]);

  return { ...state, refetch };
}
