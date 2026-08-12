/**
 * Correlation + classification: raw observations in, one provenance tree per
 * tracked value out.
 *
 * The rules run in the order BUILD_SPEC §4 lays out, and the order is the whole
 * design — a failed source outranks everything downstream of it, because a
 * value that came out of a catch block is a fallback no matter how healthy the
 * rest of the request looked.
 *
 *   1. no event for this id at all                       -> UNTRACED
 *   2. a matching server event is FALLBACK_TRIGGERED     -> FALLBACK
 *   3. no server event, and the value is a source literal-> SYNTHETIC
 *   4. server event VERIFIED, value is a passthrough     -> VERIFIED
 *   5. same, but through a named transform               -> INDIRECT
 *
 * Every `ValueProvenance` carries a `reason` saying which rule fired and on
 * what evidence. A verdict a developer can't audit is just a different flavour
 * of "Done ✅".
 */
import type {
  ClientNodeEvent,
  EventSnapshot,
  ProvenanceNode,
  ProvenanceReport,
  ProvenanceStatus,
  ServerTrace,
  TraceEvent,
  ValueProvenance,
} from "./events.js";
import { STATUS_ORDER } from "./events.js";

export interface ClassifyOptions {
  /**
   * Values found as literals in the app's own source. Best-effort by design
   * (§4 rule 3): used only to upgrade an otherwise-untraceable value to the
   * louder SYNTHETIC, never to downgrade a value with real evidence behind it.
   */
  knownLiterals?: unknown[];
}

/**
 * Builds the provenance tree for a single tracked value.
 *
 * `clientEvents` are that value's client-side observations — the most recent
 * one wins. An empty list is the UNTRACED case: the overlay asks about ids it
 * finds in the DOM, including ones the SDK never reported.
 */
export function classify(
  clientEvents: ClientNodeEvent[],
  serverTraces: ServerTrace[],
  options: ClassifyOptions = {},
): ProvenanceNode {
  const latest = latestEvent(clientEvents);
  if (latest === undefined) {
    return {
      label: "unknown value",
      status: "UNTRACED",
      detail: "no GroundTrace event was ever reported for this id",
      children: [],
    };
  }
  return provenanceFor(latest, serverTraces, options).tree;
}

/** The same analysis, with the verdict and its reasoning alongside the tree. */
export function classifyValue(
  id: string,
  snapshot: EventSnapshot,
  options: ClassifyOptions = {},
): ValueProvenance {
  const events = snapshot.nodes.filter((node) => node.id === id);
  const latest = latestEvent(events);

  if (latest === undefined) {
    return {
      id,
      status: "UNTRACED",
      value: undefined,
      source: "unknown",
      reason: `nothing was ever reported for "${id}" — it is displayed but not tracked`,
      tree: {
        label: id,
        status: "UNTRACED",
        detail: "no GroundTrace event was ever reported for this id",
        children: [],
      },
      capturedAt: 0,
    };
  }

  return provenanceFor(latest, snapshot.traces, options);
}

/** Classifies everything currently tracked and totals it up. */
export function buildReport(
  snapshot: EventSnapshot,
  options: ClassifyOptions = {},
): ProvenanceReport {
  const ids = [...new Set(snapshot.nodes.map((node) => node.id))];
  const values = ids
    .map((id) => classifyValue(id, snapshot, options))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id));

  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<
    ProvenanceStatus,
    number
  >;
  for (const value of values) counts[value.status] += 1;

  const tracked = values.length;
  const trusted = counts.VERIFIED + counts.INDIRECT;

  return {
    values,
    tracked,
    counts,
    confidence: tracked === 0 ? null : trusted / tracked,
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------

function provenanceFor(
  client: ClientNodeEvent,
  traces: ServerTrace[],
  options: ClassifyOptions,
): ValueProvenance {
  const { events: matched, trace } = matchServerEvents(client, traces);
  const verdict = decide(client, matched, options);

  const base: ValueProvenance = {
    id: client.id,
    status: verdict.status,
    value: client.value,
    source: client.source,
    reason: verdict.reason,
    tree: buildTree(client, matched, verdict),
    capturedAt: client.capturedAt,
  };
  return trace !== undefined ? { ...base, traceId: trace.traceId } : base;
}

interface Verdict {
  status: ProvenanceStatus;
  reason: string;
}

function decide(
  client: ClientNodeEvent,
  matched: TraceEvent[],
  options: ClassifyOptions,
): Verdict {
  // Rule 2 — a failed source outranks everything downstream of it.
  const failure = matched.find((event) => event.status === "FALLBACK_TRIGGERED");
  if (failure !== undefined) {
    const because =
      failure.detail !== undefined && failure.detail !== "" ? `: ${failure.detail}` : "";
    return {
      status: "FALLBACK",
      reason: `"${failure.sourceId}" failed${because} — this value is not backed by live data`,
    };
  }

  const verified = matched.filter((event) => event.status === "VERIFIED");

  if (verified.length === 0) {
    // Rule 3 — nothing on the server claims this value. If it also matches a
    // literal in the source, it was hardcoded rather than merely uninstrumented.
    if (matchesLiteral(client.value, options.knownLiterals)) {
      return {
        status: "SYNTHETIC",
        reason: `no server source produced "${client.id}", and its value appears as a literal in the source`,
      };
    }
    return {
      status: "UNTRACED",
      reason:
        client.traceId === undefined
          ? `"${client.id}" was reported without a trace id, so it could not be joined to any server source`
          : `no server source in trace ${client.traceId} claimed to produce "${client.id}"`,
    };
  }

  const transform = transformList(client.transform);
  const proof = passthroughProof(client, verified);

  // Rule 5 — a declared transform sits between the API response and the DOM.
  if (transform.length > 0) {
    return {
      status: "INDIRECT",
      reason: `produced by "${verified[0]!.sourceId}", then passed through ${transform.join(" → ")}`,
    };
  }

  if (proof === "mismatch") {
    return {
      status: "INDIRECT",
      reason: `"${verified[0]!.sourceId}" succeeded but returned a different value than the one displayed, so something transformed it`,
    };
  }

  // Rule 4 — a real source succeeded and the number on screen is its number.
  return {
    status: "VERIFIED",
    reason:
      proof === "proven"
        ? `"${verified[0]!.sourceId}" succeeded and the displayed value matches what it returned`
        : `"${verified[0]!.sourceId}" succeeded and no transform was declared (the source did not record its value, so the match is assumed)`,
  };
}

type Passthrough = "proven" | "mismatch" | "unrecorded";

function passthroughProof(client: ClientNodeEvent, verified: TraceEvent[]): Passthrough {
  for (const event of verified) {
    const recorded = event.values;
    if (recorded === undefined || !(client.id in recorded)) continue;
    return deepEqual(recorded[client.id], client.value) ? "proven" : "mismatch";
  }
  return "unrecorded";
}

interface MatchResult {
  events: TraceEvent[];
  trace: ServerTrace | undefined;
}

/**
 * Joins a DOM value to the server sources that claim to produce it.
 *
 * The trace id is the primary key. Without one we still look across every
 * trace by id — a correlation worth reporting, but the verdict's `reason` says
 * so rather than pretending the join was exact.
 */
export function matchServerEvents(
  client: ClientNodeEvent,
  traces: ServerTrace[],
): MatchResult {
  const scoped =
    client.traceId !== undefined
      ? traces.filter((trace) => trace.traceId === client.traceId)
      : traces;

  const trace =
    client.traceId !== undefined
      ? traces.find((candidate) => candidate.traceId === client.traceId)
      : undefined;

  const events = scoped
    .flatMap((candidate) => candidate.events)
    .filter((event) => produces(event, client));

  return { events, trace };
}

function produces(event: TraceEvent, client: ClientNodeEvent): boolean {
  if (event.produces?.includes(client.id) === true) return true;
  if (event.values !== undefined && client.id in event.values) return true;
  return event.sourceId === client.id || event.sourceId === client.source;
}

function buildTree(
  client: ClientNodeEvent,
  matched: TraceEvent[],
  verdict: Verdict,
): ProvenanceNode {
  const sourceChildren: ProvenanceNode[] = matched.map((event) => ({
    label: event.label ?? event.sourceId,
    status: event.status === "VERIFIED" ? "VERIFIED" : "FALLBACK",
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
    children: [],
  }));

  if (sourceChildren.length === 0) {
    sourceChildren.push({
      label: "no server source recorded",
      status: verdict.status,
      detail:
        verdict.status === "SYNTHETIC"
          ? "value appears as a literal in the source"
          : "nothing on the server claimed to produce this value",
      children: [],
    });
  }

  const sourceNode: ProvenanceNode = {
    label: client.source,
    status: verdict.status,
    children: sourceChildren,
  };

  const transform = transformList(client.transform);
  const throughTransform = transform.reduceRight<ProvenanceNode>(
    (child, name) => ({
      label: `${name}()`,
      status: "INDIRECT",
      detail: "named transform between the API response and the DOM",
      children: [child],
    }),
    sourceNode,
  );

  const componentLabel = client.component ?? client.callSite ?? "unknown call site";

  return {
    label: `${client.id} = ${formatValue(client.value)}`,
    status: verdict.status,
    detail: verdict.reason,
    children: [
      {
        label: componentLabel,
        status: verdict.status,
        children: [throughTransform],
      },
    ],
  };
}

// ---------------------------------------------------------------------------

function latestEvent(events: ClientNodeEvent[]): ClientNodeEvent | undefined {
  return events.reduce<ClientNodeEvent | undefined>(
    (best, event) =>
      best === undefined || event.capturedAt >= best.capturedAt ? event : best,
    undefined,
  );
}

function transformList(transform: string | string[] | undefined): string[] {
  if (transform === undefined) return [];
  return Array.isArray(transform) ? transform.filter((name) => name !== "") : [transform];
}

function matchesLiteral(value: unknown, literals: unknown[] | undefined): boolean {
  if (literals === undefined || literals.length === 0) return false;
  return literals.some((literal) => deepEqual(literal, value));
}

function rank(status: ProvenanceStatus): number {
  return STATUS_ORDER.indexOf(status);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => key in right && deepEqual(left[key], right[key]));
}

/** Shared value formatting so the terminal and the overlay never disagree. */
export function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number")
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object") return String(value);
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : truncate(json, 80);
  } catch {
    return "[unserialisable]";
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
