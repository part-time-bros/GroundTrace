"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import type { ClientNodeEvent } from "@groundtrace/core";
import { captureCallSite } from "./callsite.js";
import { reportNode } from "./client.js";
import { useTraceId } from "./trace-scope.js";

export interface TruthMeta {
  /** Stable id for this value; auto-generated if omitted. */
  id?: string;
  /** Human label for where this value logically comes from, e.g. `"/api/revenue"`. */
  source: string;
  /**
   * Links this value to the request that produced it. Falls back to the nearest
   * `<TraceScope>`.
   */
  traceId?: string;
  /**
   * Named transform(s) applied between the API response and the DOM. Declaring
   * one is what separates INDIRECT from VERIFIED (BUILD_SPEC §4, rule 5).
   */
  transform?: string | string[];
  component?: string;
}

/**
 * Marks a rendered value as tracked.
 *
 * Returns the value untouched — the hook is a pure observer, so wrapping a
 * value can never change what the app displays.
 */
export function useTruthValue<T>(value: T, meta: TruthMeta): T {
  const autoId = useId();
  const id = meta.id ?? autoId;
  const scopeTraceId = useTraceId();
  const traceId = meta.traceId ?? scopeTraceId;

  // Captured during render, once per mount: inside the effect below the stack
  // would show React's effect-flush frames instead of the calling component.
  const callSiteRef = useRef<string | undefined>(undefined);
  if (callSiteRef.current === undefined) {
    callSiteRef.current = captureCallSite();
  }

  // Objects get a fresh identity every render, so a raw `[value]` dep would
  // report on every render rather than on every *change*.
  const valueKey = useMemo(() => stableKey(value), [value]);
  const transformKey = useMemo(
    () => (Array.isArray(meta.transform) ? meta.transform.join(",") : meta.transform),
    [meta.transform],
  );

  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    const event: ClientNodeEvent = {
      id,
      value: latest.current,
      source: meta.source,
      capturedAt: Date.now(),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(callSiteRef.current !== undefined ? { callSite: callSiteRef.current } : {}),
      ...(meta.transform !== undefined ? { transform: meta.transform } : {}),
      ...(meta.component !== undefined ? { component: meta.component } : {}),
    };
    reportNode(event);
    // `valueKey` stands in for `value`; `transformKey` for `meta.transform`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, valueKey, meta.source, traceId, transformKey, meta.component]);

  return value;
}

/**
 * A structural key for change detection. Deliberately cheap and best-effort:
 * this decides how often we report, never what a value *is*.
 */
export function stableKey(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value !== "object") return `${typeof value}:${String(value)}`;
  try {
    return JSON.stringify(value, sortedReplacer) ?? "object";
  } catch {
    return "object:unserialisable";
  }
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries);
}
