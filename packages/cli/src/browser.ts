/**
 * Optional headless-browser support for `groundtrace verify` (V2_SPEC §10).
 *
 * V1's `verify` ran headless with no DOM to read, so it reconstructed the
 * client half of every value and honestly marked it unobserved. That meant it
 * could never prove the claim the overlay makes — that the number *on screen*
 * is the number the source returned. Loading the page in a real browser makes
 * the app's own SDK report real values to the collector, which turns the whole
 * scan into first-hand evidence.
 *
 * Playwright is resolved at runtime and never becomes a dependency: plenty of
 * projects have it already, and forcing a browser download on everyone else to
 * make one optional feature work is a bad trade.
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);

/** The slice of Playwright's surface we actually use. */
interface BrowserPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  click(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForFunction(
    fn: string,
    arg?: unknown,
    options?: { timeout?: number },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
}

interface BrowserInstance {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface ChromiumLauncher {
  launch(options?: {
    executablePath?: string;
    args?: string[];
  }): Promise<BrowserInstance>;
}

export interface BrowserScanOptions {
  /** Base URL to visit — the collector's proxy, so the SDK reports land locally. */
  url: string;
  routes: string[];
  /** CSS selectors clicked on every page before reading it. */
  interactions?: string[];
  /** Explicit browser binary. Falls back to `GROUNDTRACE_BROWSER_PATH`, then discovery. */
  browserPath?: string;
  timeoutMs?: number;
}

export interface BrowserScanResult {
  ran: boolean;
  /** Why it didn't run, when it didn't. */
  reason?: string;
  routesVisited: number;
  /** Every `[data-truth-id]` found in the DOM, including ones nothing reported. */
  domIds: string[];
  /** Interaction selectors that actually fired. */
  interactionsRun: number;
}

/** Resolves Playwright without depending on it. */
function loadChromium(): ChromiumLauncher | undefined {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const mod = require_(name) as { chromium?: ChromiumLauncher };
      if (mod.chromium !== undefined) return mod.chromium;
    } catch {
      // Not installed — try the next one.
    }
  }
  return undefined;
}

/**
 * Finds a Chromium build under `PLAYWRIGHT_BROWSERS_PATH`.
 *
 * Playwright pins an exact browser build per release, so a shared browser cache
 * provisioned for a different Playwright version fails to launch with a bare
 * "Executable doesn't exist". Looking for whatever build *is* there turns that
 * into a working scan instead of a confusing error.
 */
export function discoverBrowserPath(root?: string): string | undefined {
  const base = root ?? process.env["PLAYWRIGHT_BROWSERS_PATH"];
  if (base === undefined || base === "" || !existsSync(base)) return undefined;

  const candidates = [
    ["chromium", "chrome-linux", "chrome"],
    ["chromium", "chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
    ["chrome-linux64", "chrome"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-win", "chrome.exe"],
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chrome-linux", "headless_shell"],
  ];

  let entries: string[];
  try {
    entries = readdirSync(base).filter((entry) => entry.startsWith("chromium"));
  } catch {
    return undefined;
  }

  // Newest build number first.
  entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  for (const entry of entries) {
    for (const parts of candidates) {
      const candidate = join(base, entry, ...parts);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function launch(
  chromium: ChromiumLauncher,
  browserPath: string | undefined,
): Promise<BrowserInstance> {
  // Only ever visits the local app, so bypassing any ambient HTTP proxy is
  // both safe and necessary in sandboxes that route everything through one.
  const args = ["--no-proxy-server"];

  if (browserPath !== undefined && browserPath !== "") {
    return chromium.launch({ executablePath: browserPath, args });
  }

  try {
    return await chromium.launch({ args });
  } catch (error) {
    const discovered = discoverBrowserPath();
    if (discovered === undefined) throw error;
    return chromium.launch({ executablePath: discovered, args });
  }
}

/**
 * Visits each route so the app's own SDK reports real values to the collector,
 * and collects the `data-truth-id`s present in the DOM.
 */
export async function scanInBrowser(
  options: BrowserScanOptions,
): Promise<BrowserScanResult> {
  const chromium = loadChromium();
  if (chromium === undefined) {
    return {
      ran: false,
      reason: "playwright is not installed — install it for a real-DOM scan",
      routesVisited: 0,
      domIds: [],
      interactionsRun: 0,
    };
  }

  const browserPath = options.browserPath ?? process.env["GROUNDTRACE_BROWSER_PATH"];
  const timeout = options.timeoutMs ?? 30_000;

  let browser: BrowserInstance;
  try {
    browser = await launch(chromium, browserPath);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return {
      ran: false,
      reason: `could not launch a browser: ${message}`,
      routesVisited: 0,
      domIds: [],
      interactionsRun: 0,
    };
  }

  const domIds = new Set<string>();
  let routesVisited = 0;
  let interactionsRun = 0;

  try {
    for (const route of options.routes) {
      const page = await browser.newPage();
      try {
        await page.goto(new URL(route, options.url).toString(), {
          waitUntil: "load",
          timeout,
        });

        // Wait for the SDK's own handshake when the page has one, so reports
        // have actually landed before we read anything.
        try {
          await page.waitForFunction(
            "typeof window.__groundtraceReady__ === 'function'",
            undefined,
            { timeout: 5_000 },
          );
          await page.evaluate<void>("window.__groundtraceReady__()");
        } catch {
          // A page with no tracked values never publishes it. Not an error.
        }
        await page.waitForTimeout(250);

        // Reveal anything behind a tab or a toggle before reading the page.
        for (const selector of options.interactions ?? []) {
          try {
            await page.click(selector, { timeout: 2_000 });
            interactionsRun += 1;
            await page.waitForTimeout(400);
          } catch {
            // A selector that isn't on this route is not an error.
          }
        }

        const ids = await page.evaluate<string[]>(
          "Array.from(document.querySelectorAll('[data-truth-id]')).map((el) => el.getAttribute('data-truth-id')).filter(Boolean)",
        );
        for (const id of ids) domIds.add(id);
        routesVisited += 1;
      } catch {
        // A route that fails to load is not evidence of anything; skip it.
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return { ran: true, routesVisited, interactionsRun, domIds: [...domIds].sort() };
}
