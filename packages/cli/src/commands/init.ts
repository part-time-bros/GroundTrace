/**
 * `groundtrace init` — drops config into an existing project.
 *
 * Everything it writes is additive and idempotent: run it twice and nothing
 * changes. It will not overwrite an existing config unless asked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  configPath,
  saveConfig,
  type GroundTraceConfig,
} from "../config.js";
import { HOOK_COMMAND, mergeStopHook, type ClaudeSettings } from "../claude-hook.js";
import { paint, tick } from "../ui.js";

export interface InitOptions {
  cwd: string;
  /** Also add the Claude Code `Stop` hook (BUILD_SPEC §8). */
  claudeCodeHook?: boolean;
  force?: boolean;
  quiet?: boolean;
}

export interface InitResult {
  configPath: string;
  configWritten: boolean;
  settingsPath?: string;
  settingsWritten?: boolean;
}

export function runInit(options: InitOptions): InitResult {
  const path = configPath(options.cwd);
  const exists = existsSync(path);

  let configWritten = false;
  if (!exists || options.force === true) {
    saveConfig(options.cwd, detectConfig(options.cwd));
    configWritten = true;
  }

  const result: InitResult = { configPath: path, configWritten };

  if (options.claudeCodeHook === true) {
    const hook = writeClaudeHook(options.cwd);
    result.settingsPath = hook.path;
    result.settingsWritten = hook.written;
  }

  if (options.quiet !== true) {
    print(options.cwd, result, exists);
  }

  return result;
}

/**
 * Guesses the project's own commands so the config is useful without editing.
 *
 * Deliberately ignores any config already on disk: this is what `--force`
 * writes, and a "regenerate" that silently kept the old values would be a
 * confusing no-op.
 */
export function detectConfig(cwd: string): GroundTraceConfig {
  const config = { ...DEFAULT_CONFIG };

  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return config;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};

    if (scripts["dev"] !== undefined) config.dev = "npm run dev";
    if (scripts["build"] !== undefined) config.build = "npm run build";
    if (scripts["test"] !== undefined) config.test = "npm test";
  } catch {
    // A package.json we can't parse just means we keep the defaults.
  }

  return config;
}

export const CLAUDE_SETTINGS_PATH = join(".claude", "settings.json");

export function writeClaudeHook(cwd: string): { path: string; written: boolean } {
  const path = join(cwd, CLAUDE_SETTINGS_PATH);

  let existing: ClaudeSettings | undefined;
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8")) as ClaudeSettings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Overwriting a file we failed to parse could destroy real settings.
      throw new Error(`${path} is not valid JSON, refusing to overwrite it: ${message}`, {
        cause: error,
      });
    }
  }

  const merged = mergeStopHook(existing, HOOK_COMMAND);
  if (JSON.stringify(merged) === JSON.stringify(existing)) {
    return { path, written: false };
  }

  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  return { path, written: true };
}

function print(cwd: string, result: InitResult, configExisted: boolean): void {
  const where = (path: string) => relative(cwd, path) || path;

  console.log("");
  if (result.configWritten) {
    console.log(tick(`wrote ${where(result.configPath)}`));
  } else {
    console.log(
      `${paint("·", "gray")} ${where(result.configPath)} already exists${
        configExisted ? " — left alone (use --force to overwrite)" : ""
      }`,
    );
  }

  if (result.settingsPath !== undefined) {
    console.log(
      result.settingsWritten === true
        ? tick(`added the Stop hook to ${where(result.settingsPath)}`)
        : `${paint("·", "gray")} ${where(result.settingsPath)} already has the Stop hook`,
    );
  }

  console.log("");
  console.log("Next:");
  console.log(`  1. wrap a route handler in ${paint("traceRoute()", "bold")}`);
  console.log(`  2. wrap a displayed value in ${paint("useTruthValue()", "bold")}`);
  console.log(`  3. run ${paint("npx groundtrace run", "bold")} and click the value`);
  console.log("");
  console.log(
    paint(`edit ${CONFIG_FILENAME} if the detected commands are wrong`, "gray"),
  );
  console.log("");
}
