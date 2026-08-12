"use client";

/**
 * Zero-config tagging (V2_SPEC §14).
 *
 * Fetches what the server said it produced, scans the page for elements whose
 * rendered number matches, tags them with `data-truth-id`, and reports them.
 * The result is the original pitch's promise — click a number, see where it came
 * from — with no `useTruthValue` calls anywhere in the app.
 *
 * It matches on the **DOM** rather than on React's fiber tree. V2_SPEC sketched a
 * fiber walk, but a rendered text node is a rendered text node: matching there
 * works identically for React, Vue, Svelte, and server-rendered HTML, where a
 * fiber walk works for exactly one of them. `bippy` still supplies the component
 * name when React is present, which is the part fibers are genuinely needed for.
 */
import {
  COLLECTOR_BASE,
  type ClientNodeEvent,
  type ServerTrace,
} from "@groundtrace/core";
import {
  indexSourceValues,
  matchDisplayedValue,
  valueKey,
  type SourceValue,
} from "./match.js";

export const TRUTH_ATTRIBUTE = "data-truth-id";
const AUTO_ATTRIBUTE = "data-truth-auto";

export interface AutoOptions {
  /** Collector base URL. Defaults to the page's own origin. */
  endpoint?: string;
  document?: Document;
  /** Elements to consider. Defaults to leaf elements holding text. */
  selector?: string;
  /** How often to re-scan, in ms. Defaults to 1000. */
  intervalMs?: number;
  /** Swappable for tests. */
  fetchSnapshot?: () => Promise<{ traces: ServerTrace[] }>;
  report?: (events: ClientNodeEvent[]) => void | Promise<void>;
}

export interface AutoHandle {
  /**
   * Scans once and returns every value currently matched on the page.
   *
   * The return value describes the page; only values whose reading *changed*
   * are reported to the collector. Returning just the delta made a second scan
   * look like it had found nothing, which was misleading.
   */
  scan(): Promise<ClientNodeEvent[]>;
  stop(): void;
}

/** Elements that hold a value, rather than containers that hold other elements. */
const DEFAULT_SELECTOR =
  "span, b, strong, em, td, th, dd, dt, h1, h2, h3, h4, h5, h6, p, div, li, output, data";

function isLeafText(element: Element): boolean {
  if (element.children.length > 0) return false;
  const text = element.textContent ?? "";
  return text.trim() !== "";
}

export function startAutoTagging(options: AutoOptions = {}): AutoHandle {
  const doc = options.document ?? globalThis.document;
  if (doc === undefined) {
    throw new Error("startAutoTagging requires a document — it is browser-only.");
  }

  const selector = options.selector ?? DEFAULT_SELECTOR;
  const fetchSnapshot = options.fetchSnapshot ?? makeSnapshotFetcher(options.endpoint);
  const report = options.report ?? makeReporter(options.endpoint);

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  // Same rule the React SDK follows: report once per *change*, not once per
  // scan. Without it a 1s polling interval would re-send every value on the
  // page every second.
  const lastReported = new Map<string, string>();

  async function scan(): Promise<ClientNodeEvent[]> {
    if (stopped) return [];

    let traces: ServerTrace[];
    try {
      traces = (await fetchSnapshot()).traces;
    } catch {
      // No collector reachable — nothing to match against. Not an error.
      return [];
    }

    const index = indexSourceValues(traces);
    if (index.size === 0) return [];

    const matched: ClientNodeEvent[] = [];
    const changed: ClientNodeEvent[] = [];
    const seen = new Set<string>();

    for (const element of doc.querySelectorAll(selector)) {
      // Never touch a value the developer tagged themselves — an explicit
      // declaration always outranks an inferred one.
      if (
        element.hasAttribute(TRUTH_ATTRIBUTE) &&
        !element.hasAttribute(AUTO_ATTRIBUTE)
      ) {
        continue;
      }
      if (!isLeafText(element)) continue;

      const result = matchDisplayedValue(element.textContent ?? "", index);
      if (result === undefined) continue;

      // One element per id per scan: the first (outermost, document-order) match
      // wins rather than tagging every element that repeats the number.
      if (seen.has(result.match.id)) continue;
      seen.add(result.match.id);

      element.setAttribute(TRUTH_ATTRIBUTE, result.match.id);
      element.setAttribute(AUTO_ATTRIBUTE, "true");

      const event = toEvent(result.match, result.candidates, element);
      matched.push(event);

      const signature = `${valueKey(result.match.value) ?? ""}|${result.candidates}|${result.match.traceId}`;
      if (lastReported.get(result.match.id) === signature) continue;
      lastReported.set(result.match.id, signature);
      changed.push(event);
    }

    if (changed.length > 0) {
      try {
        await report(changed);
      } catch {
        // Reporting failures stay inside the tool, as everywhere else.
      }
    }

    return matched;
  }

  void scan();
  timer = setInterval(() => void scan(), options.intervalMs ?? 1_000);

  return {
    scan,
    stop() {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}

function toEvent(
  match: SourceValue,
  candidates: number,
  element: Element,
): ClientNodeEvent {
  return {
    id: match.id,
    value: match.value,
    source: match.sourceId,
    traceId: match.traceId,
    capturedAt: Date.now(),
    auto: true,
    candidates,
    callSite: describeElement(element),
  };
}

/** A stable, readable label for an element that has no call site to report. */
export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id !== "" ? `#${element.id}` : "";
  const cls =
    element.classList.length > 0
      ? `.${[...element.classList].slice(0, 2).join(".")}`
      : "";
  return `<${tag}${id}${cls}> (auto-tagged)`;
}

function makeSnapshotFetcher(endpoint: string | undefined) {
  return async (): Promise<{ traces: ServerTrace[] }> => {
    const base = endpoint ?? globalThis.location?.origin ?? "http://localhost";
    const response = await fetch(new URL(`${COLLECTOR_BASE}/events`, base), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`collector responded ${response.status}`);
    return (await response.json()) as { traces: ServerTrace[] };
  };
}

function makeReporter(endpoint: string | undefined) {
  return async (events: ClientNodeEvent[]): Promise<void> => {
    const base = endpoint ?? globalThis.location?.origin ?? "http://localhost";
    await fetch(new URL(`${COLLECTOR_BASE}/nodes`, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
      keepalive: true,
    });
  };
}
