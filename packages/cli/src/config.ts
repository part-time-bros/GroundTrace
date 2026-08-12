/**
 * `groundtrace.config.json` — what `init` writes and everything else reads.
 *
 * Every field has a working default, so a project with no config file at all
 * still gets sensible behaviour from `run` and `verify`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const CONFIG_FILENAME = "groundtrace.config.json";

export interface GroundTraceConfig {
  /** Command that starts the app in dev mode. */
  dev: string;
  /** Port the app itself listens on. */
  appPort: number;
  /** Port the collector + overlay-injecting proxy listen on. */
  port: number;
  /** Build command `verify` runs. */
  build: string;
  /** Test command `verify` runs. */
  test: string;
  /** Routes `verify` exercises to gather server-side evidence. */
  routes: string[];
  /** Directories scanned for tracked value ids and fallback literals. */
  scan: string[];
  /**
   * CSS selectors to click before reading each page.
   *
   * Values behind a tab, an accordion, or a "load more" button are invisible to
   * a scan that only navigates — which means `verify` would report a page as
   * fully verified while never having seen half of it.
   */
  interactions?: string[];
}

export const DEFAULT_CONFIG: GroundTraceConfig = {
  dev: "next dev",
  appPort: 3000,
  port: 7777,
  build: "next build",
  test: "vitest run",
  routes: ["/"],
  scan: ["app", "src", "components", "pages", "lib"],
  interactions: [],
};

export function configPath(cwd: string): string {
  return join(resolve(cwd), CONFIG_FILENAME);
}

export function loadConfig(cwd: string): GroundTraceConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<GroundTraceConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${CONFIG_FILENAME} is not valid JSON: ${message}`, {
      cause: error,
    });
  }
}

export function saveConfig(cwd: string, config: GroundTraceConfig): string {
  const path = configPath(cwd);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return path;
}
