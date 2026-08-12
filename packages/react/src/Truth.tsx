"use client";

/**
 * JSX wrapper for cases where the hook is awkward — it tracks the value and
 * tags the DOM node in one step, so the `data-truth-id` can't drift out of sync
 * with the tracked id the way two separate edits can.
 */
import { createElement, type ElementType, type ReactNode } from "react";
import { useTruthValue, type TruthMeta } from "./useTruthValue.js";

export interface TruthProps extends Omit<TruthMeta, "id"> {
  id: string;
  children: ReactNode;
  /** Element to render. Defaults to `span`. */
  as?: ElementType;
  className?: string;
  /** Tracks this instead of `children` — use it when children are formatted. */
  value?: unknown;
}

export function Truth({
  id,
  source,
  traceId,
  transform,
  component,
  children,
  as: Tag = "span",
  className,
  value,
}: TruthProps) {
  useTruthValue(value !== undefined ? value : children, {
    id,
    source,
    ...(traceId !== undefined ? { traceId } : {}),
    ...(transform !== undefined ? { transform } : {}),
    ...(component !== undefined ? { component } : {}),
  });

  return createElement(
    Tag,
    { "data-truth-id": id, ...(className !== undefined ? { className } : {}) },
    children,
  );
}
