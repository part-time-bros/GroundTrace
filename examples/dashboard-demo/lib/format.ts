export function formatCurrency(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatCount(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/**
 * A named transform, and named on purpose: it turns the API's `0.146` into the
 * `14.6` on screen, so GroundTrace classifies growth as 🟡 INDIRECT rather than
 * 🟢 VERIFIED. That distinction is the whole point of having both statuses.
 */
export function toPercent(ratio: number | undefined): number | undefined {
  return ratio === undefined ? undefined : Math.round(ratio * 1_000) / 10;
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
