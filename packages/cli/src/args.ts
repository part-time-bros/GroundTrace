/**
 * A ~60-line argv parser. GroundTrace's CLI surface is five subcommands with a
 * handful of flags; pulling in an argument-parsing dependency for that would
 * cost more (install weight, a transitive tree to audit) than it saves.
 */

export interface ParsedArgs {
  command: string | undefined;
  /** Positional arguments after the subcommand, before any `--`. */
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** Everything after a bare `--`, joined back into one shell command string. */
  passthrough: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const passthrough: string[] = [];

  let command: string | undefined;
  let seenSeparator = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (seenSeparator) {
      passthrough.push(token);
      continue;
    }
    if (token === "--") {
      seenSeparator = true;
      continue;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-") && next !== "--") {
        flags[body] = next;
        index += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      flags[token.slice(1)] = true;
      continue;
    }

    if (command === undefined) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags, passthrough };
}

export function flagString(args: ParsedArgs, name: string, fallback: string): string;
export function flagString(
  args: ParsedArgs,
  name: string,
  fallback?: undefined,
): string | undefined;
export function flagString(
  args: ParsedArgs,
  name: string,
  fallback?: string,
): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : fallback;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  const value = args.flags[name];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "false" && value !== "0";
  return false;
}

export function flagNumber(args: ParsedArgs, name: string, fallback: number): number {
  const value = flagString(args, name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
