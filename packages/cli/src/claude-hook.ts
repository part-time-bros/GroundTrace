/**
 * Claude Code `Stop` hook integration (BUILD_SPEC §8).
 *
 * V1 is informational only: it prints a confidence report after Claude finishes
 * a turn, and never blocks the stop event. Auto-blocking on a heuristic score
 * would create annoying loops long before it caught a real bug — that's a V2
 * experiment for once the scoring has a track record.
 *
 * The merge below is the part that has to be careful. This writes into someone
 * else's settings file, so it must never clobber hooks it didn't add.
 */

export const HOOK_COMMAND = "npx groundtrace verify --quiet || true";

export interface HookEntry {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

export interface HookMatcher {
  matcher?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

/**
 * Adds the Stop hook to `settings`, leaving everything else exactly as it was.
 *
 * `|| true` on the command is deliberate: a hook that exits non-zero for an
 * unrelated reason (groundtrace not installed in this particular project)
 * shouldn't break Claude Code's normal stop flow. The report is a signal, not
 * a gate.
 */
export function mergeStopHook(
  settings: ClaudeSettings | undefined,
  command: string = HOOK_COMMAND,
): ClaudeSettings {
  const base: ClaudeSettings = settings === undefined ? {} : { ...settings };
  const hooks: Record<string, HookMatcher[]> = { ...(base.hooks ?? {}) };
  const stop: HookMatcher[] = [...(hooks["Stop"] ?? [])];

  if (alreadyPresent(stop, command)) {
    return { ...base, hooks: { ...hooks, Stop: stop } };
  }

  const target = stop.find((matcher) => Array.isArray(matcher.hooks));
  if (target === undefined) {
    // No Stop hooks yet (or none in the expected shape) — add our own group.
    stop.push({ hooks: [{ type: "command", command }] });
  } else {
    // Append to the existing group rather than replacing it.
    const index = stop.indexOf(target);
    stop[index] = {
      ...target,
      hooks: [...(target.hooks ?? []), { type: "command", command }],
    };
  }

  return { ...base, hooks: { ...hooks, Stop: stop } };
}

export function alreadyPresent(stop: HookMatcher[], command: string): boolean {
  return stop.some((matcher) =>
    (matcher.hooks ?? []).some((hook) => hook.command === command),
  );
}

// ---------------------------------------------------------------------------
// MCP registration (V2_SPEC §11)
// ---------------------------------------------------------------------------

export const MCP_SERVER_NAME = "groundtrace";
export const MCP_CONFIG_FILENAME = ".mcp.json";

export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export const DEFAULT_MCP_ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "@groundtrace/mcp"],
};

/**
 * Registers the MCP server in a project's `.mcp.json`, leaving every other
 * server alone. Same rule as the Stop hook: this writes into a file the user
 * owns, so it must never clobber entries it didn't add.
 */
export function mergeMcpServer(
  config: McpConfig | undefined,
  entry: McpServerEntry = DEFAULT_MCP_ENTRY,
  name: string = MCP_SERVER_NAME,
): McpConfig {
  const base: McpConfig = config === undefined ? {} : { ...config };
  const servers = { ...(base.mcpServers ?? {}) };

  // An existing entry under our name is left as-is: the user may have pointed
  // it at a local build or added env of their own.
  servers[name] ??= entry;

  return { ...base, mcpServers: servers };
}
