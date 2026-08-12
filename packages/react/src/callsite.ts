/**
 * Source-location capture without a compiler plugin.
 *
 * `new Error().stack` inside the tracking call points at the caller. In a dev
 * build source maps are on by default (Next dev, Vite), so the frame resolves
 * to the real `.tsx` file and line rather than bundled output — which is what
 * lets V1 skip a Babel/SWC pass entirely (BUILD_SPEC §3).
 *
 * Timing matters: the stack has to be taken during render, at the
 * `useTruthValue` call itself. Taking it inside the effect — as the spec's
 * sketch does — captures React's effect-flush frames instead of the component.
 */

/** Frames belonging to GroundTrace itself, or to React's own machinery. */
const INTERNAL = /groundtrace|node_modules[/\\](?:react|next|scheduler)[/\\]/i;

export function captureCallSite(stack?: string): string | undefined {
  const raw = stack ?? new Error().stack;
  if (raw === undefined) return undefined;

  const frames = raw
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const frame = frames.find((line) => !INTERNAL.test(line)) ?? frames[0];
  return frame === undefined ? undefined : prettifyFrame(frame);
}

/**
 * Turns `"at DashboardCard (webpack-internal:///./app/card.tsx:42:19)"` into
 * `"DashboardCard (card.tsx:42)"` — the column and the bundler URL prefix are
 * noise in an overlay tree.
 */
export function prettifyFrame(frame: string): string {
  const cleaned = frame.replace(/^at\s+/, "");
  const match = /^(.*?)\s*\((.+)\)$/.exec(cleaned);
  const fnName = match?.[1]?.trim();
  const location = match?.[2] ?? cleaned;

  const shortened = shortenLocation(location);
  return fnName !== undefined && fnName !== "" && fnName !== "<anonymous>"
    ? `${fnName} (${shortened})`
    : shortened;
}

function shortenLocation(location: string): string {
  const withoutColumn = location.replace(/:(\d+):(\d+)$/, ":$1");
  const parts = withoutColumn.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last === undefined || last === "" ? withoutColumn : last;
}
