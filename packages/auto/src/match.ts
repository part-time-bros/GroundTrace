/**
 * Value matching for zero-config instrumentation (V2_SPEC §14).
 *
 * The whole trick: instrumented server code already records the values each
 * source produced. If a number rendered on the page equals one of those, the
 * page is very probably showing that source's output — no `useTruthValue` call
 * required.
 *
 * "Very probably" is doing real work in that sentence, and the rest of this
 * file exists to keep it honest. A match is evidence, not proof: two metrics
 * that happen to hold the same number are genuinely ambiguous, and the caller
 * is told how many candidates there were rather than handed a guess.
 */
import type { ServerTrace } from "@groundtrace/core";

export interface SourceValue {
  /** The tracked value id the source declared, e.g. `"revenue"`. */
  id: string;
  sourceId: string;
  traceId: string;
  value: unknown;
  /** True when the producing call failed — this value came from a fallback. */
  failed: boolean;
}

/**
 * Parses a number out of displayed text.
 *
 * Handles the formatting a dashboard actually applies — currency symbols,
 * thousands separators, percent signs, explicit plus signs, parenthesised
 * negatives — because the rendered string is almost never the raw value.
 */
export function parseDisplayedNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > 40) return undefined;

  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/^\(|\)$/g, "")
    .replace(/[\s\u00a0\u202f\u2009]/g, "")
    // Currency symbols and the percent sign, but not digits, separators or signs.
    .replace(/[^\d.,+-]/g, "");

  if (cleaned === "" || !/\d/.test(cleaned)) return undefined;

  // `1,234.56` → `1234.56`. A comma used as a decimal separator (`1,5`) is
  // ambiguous with thousands grouping; grouping is the far more common case in
  // the formats this sees, so commas are dropped.
  const normalised = cleaned.replace(/,/g, "");
  if (!/^[+-]?\d*\.?\d+$/.test(normalised)) return undefined;

  const parsed = Number.parseFloat(normalised);
  if (!Number.isFinite(parsed)) return undefined;

  return negative ? -Math.abs(parsed) : parsed;
}

/** A stable key for value equality, so `96159` and `"96159"` match. */
export function valueKey(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value === "string") {
    const parsed = parseDisplayedNumber(value);
    return parsed === undefined ? `s:${value}` : String(parsed);
  }
  if (typeof value === "boolean") return `b:${String(value)}`;
  return undefined;
}

/**
 * Indexes every value the server said it produced, keyed for lookup by a
 * number read off the page.
 */
export function indexSourceValues(traces: ServerTrace[]): Map<string, SourceValue[]> {
  const index = new Map<string, SourceValue[]>();

  for (const trace of traces) {
    for (const event of trace.events) {
      for (const [id, value] of Object.entries(event.values ?? {})) {
        const key = valueKey(value);
        if (key === undefined) continue;

        const entry: SourceValue = {
          id,
          sourceId: event.sourceId,
          traceId: trace.traceId,
          value,
          failed: event.status === "FALLBACK_TRIGGERED",
        };

        const existing = index.get(key);
        if (existing === undefined) index.set(key, [entry]);
        else existing.push(entry);
      }
    }
  }

  return index;
}

export interface MatchResult {
  match: SourceValue;
  /** How many distinct tracked ids the number could have come from. */
  candidates: number;
}

/**
 * Finds the source a displayed number probably came from.
 *
 * When several *different* tracked ids share the number, the count is reported
 * so the caller can mark the match ambiguous. A failed source wins the tie —
 * if one of the candidates came out of a catch block, that is the possibility
 * worth surfacing.
 */
export function matchDisplayedValue(
  text: string,
  index: Map<string, SourceValue[]>,
): MatchResult | undefined {
  const parsed = parseDisplayedNumber(text);
  if (parsed === undefined) return undefined;

  const entries = index.get(String(parsed));
  if (entries === undefined || entries.length === 0) return undefined;

  const distinctIds = new Set(entries.map((entry) => entry.id));
  const failed = entries.find((entry) => entry.failed);

  return { match: failed ?? entries[0]!, candidates: distinctIds.size };
}
