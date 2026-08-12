/**
 * Terminal formatting shared by every GroundTrace command.
 *
 * The house style (see BUILD_SPEC §5) is a terminal/debugger aesthetic where
 * colour carries meaning and nothing else: the five classification colours are
 * status lights, not decoration. The same restraint applies here.
 */

const FORCE_COLOR = process.env["FORCE_COLOR"];
const NO_COLOR = process.env["NO_COLOR"];

export function colorEnabled(): boolean {
  if (NO_COLOR !== undefined && NO_COLOR !== "") return false;
  if (FORCE_COLOR !== undefined && FORCE_COLOR !== "" && FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

const CODES = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  orange: "\u001b[38;5;208m",
  gray: "\u001b[90m",
} as const;

export type Ink = keyof Omit<typeof CODES, "reset">;

export function paint(text: string, ink: Ink): string {
  if (!colorEnabled()) return text;
  return `${CODES[ink]}${text}${CODES.reset}`;
}

export const RULE = "━";

/** A titled box: the report format the pitch specified, verbatim. */
export function box(title: string, lines: string[], ruleWidth?: number): string {
  const width = ruleWidth ?? Math.max(title.length, ...lines.map(visibleLength), 20);
  return [paint(title, "bold"), RULE.repeat(width), ...lines].join("\n");
}

/** Length ignoring ANSI escapes, so coloured text doesn't blow out box rules. */
export function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

export function pad(text: string, width: number): string {
  const deficit = width - visibleLength(text);
  return deficit > 0 ? text + " ".repeat(deficit) : text;
}

export const TICK = "✓";
export const CROSS = "✗";
export const QUERY = "?";

export function tick(label: string): string {
  return `${paint(TICK, "green")} ${label}`;
}

export function cross(label: string): string {
  return `${paint(CROSS, "red")} ${label}`;
}

export function unknown(label: string): string {
  return `${paint(QUERY, "yellow")} ${label}`;
}
