/**
 * The wire vocabulary shared by every GroundTrace package.
 *
 * Two streams of raw evidence meet here:
 *   - the server stream (`ServerTrace` / `TraceEvent`) written by `@groundtrace/node`
 *   - the client stream (`ClientNodeEvent`) written by `@groundtrace/react`
 *
 * They are joined on `traceId` and classified in `classify.ts`. Nothing in this
 * file interprets anything — these are observations, not conclusions.
 */

/** The five classifications a displayed value can end up with. */
export type ProvenanceStatus =
  "VERIFIED" | "INDIRECT" | "FALLBACK" | "SYNTHETIC" | "UNTRACED";

/** What a wrapped server-side call was observed to do. */
export type TraceEventStatus = "VERIFIED" | "FALLBACK_TRIGGERED";

/** What kind of thing produced the value — used for the overlay's tree labels. */
export type TraceEventKind = "db" | "fetch" | "compute" | "route";

export interface TraceEvent {
  /** Stable id for the wrapped call, e.g. `"revenue-query"`. */
  sourceId: string;
  status: TraceEventStatus;
  /** Why a fallback triggered — usually the caught error's message. */
  detail?: string;
  timestamp: number;
  kind?: TraceEventKind;
  /** Human label for the tree, e.g. `"SELECT SUM(total) FROM orders"`. */
  label?: string;
  durationMs?: number;
  /**
   * Which tracked value ids this call feeds. This is the explicit join between
   * a server-side source and the DOM nodes downstream of it — V1 asks for it
   * rather than inferring it, which is the same opt-in trade the SDK makes
   * everywhere else.
   */
  produces?: string[];
  /**
   * The actual values produced, keyed by tracked value id. When present, the
   * classifier can *prove* the number on screen is the number the source
   * returned instead of assuming it.
   */
  values?: Record<string, unknown>;
}

export interface ServerTrace {
  traceId: string;
  route?: string;
  startedAt: number;
  endedAt?: number;
  events: TraceEvent[];
}

export interface ClientNodeEvent {
  /** The `data-truth-id` of the DOM node showing this value. */
  id: string;
  value: unknown;
  /** Human label for where the value logically comes from, e.g. `"/api/revenue"`. */
  source: string;
  /** Links this DOM value back to the server trace that produced it. */
  traceId?: string;
  /** Best-effort `.tsx` file and line, read off a captured stack. */
  callSite?: string;
  /**
   * False when the value was inferred rather than read from the DOM — a
   * headless `groundtrace verify` scan knows an id exists and knows which
   * source feeds it, but never saw anything rendered. Defaults to true.
   */
  valueObserved?: boolean;
  /**
   * True when this value was matched automatically (V2_SPEC §14) rather than
   * declared with `useTruthValue`. The correlation is inferred from the value
   * itself, so it is evidence rather than proof.
   */
  auto?: boolean;
  /**
   * How many distinct tracked ids the auto-matched value could have come from.
   * Anything above 1 means the match is ambiguous and must not be presented as
   * settled.
   */
  candidates?: number;
  /** Named transform(s) applied between the API response and the DOM. */
  transform?: string | string[];
  /** Component that rendered it, when the SDK could work it out. */
  component?: string;
  capturedAt: number;
}

/** One node in a provenance tree, as rendered by the overlay and the CLI. */
export interface ProvenanceNode {
  label: string;
  status: ProvenanceStatus;
  /** Extra line shown under the label in the overlay, e.g. an error message. */
  detail?: string;
  children: ProvenanceNode[];
}

export interface ValueProvenance {
  id: string;
  status: ProvenanceStatus;
  value: unknown;
  source: string;
  traceId?: string;
  /** One-line plain-English explanation of why this status was chosen. */
  reason: string;
  tree: ProvenanceNode;
  capturedAt: number;
}

export interface ProvenanceReport {
  values: ValueProvenance[];
  tracked: number;
  counts: Record<ProvenanceStatus, number>;
  /** (verified + indirect) / tracked, as a 0–1 fraction. `null` when nothing is tracked. */
  confidence: number | null;
  generatedAt: number;
}

/** Everything the collector holds, as one serialisable blob. */
export interface EventSnapshot {
  nodes: ClientNodeEvent[];
  traces: ServerTrace[];
}

export const STATUS_ORDER: ProvenanceStatus[] = [
  "VERIFIED",
  "INDIRECT",
  "FALLBACK",
  "SYNTHETIC",
  "UNTRACED",
];

/**
 * Status lights. These five glyphs are the only colour in the overlay UI and
 * they mean the same thing in the terminal, in the browser, and in the docs.
 */
export const STATUS_LIGHT: Record<ProvenanceStatus, string> = {
  VERIFIED: "🟢",
  INDIRECT: "🟡",
  FALLBACK: "🟠",
  SYNTHETIC: "🔴",
  UNTRACED: "⚪",
};
