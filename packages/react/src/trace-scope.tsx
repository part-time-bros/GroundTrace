"use client";

/**
 * Carries the current request's trace id down to every tracked value inside it,
 * so a page with a dozen `useTruthValue` calls doesn't have to prop-drill the
 * same id a dozen times.
 */
import { createContext, createElement, useContext, type ReactNode } from "react";

const TraceIdContext = createContext<string | undefined>(undefined);

export function useTraceId(): string | undefined {
  return useContext(TraceIdContext);
}

export interface TraceScopeProps {
  traceId: string | undefined;
  children: ReactNode;
}

export function TraceScope({ traceId, children }: TraceScopeProps) {
  return createElement(TraceIdContext.Provider, { value: traceId }, children);
}
