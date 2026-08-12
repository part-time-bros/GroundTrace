import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverBrowserPath, scanInBrowser } from "./browser.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "groundtrace-browser-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("discoverBrowserPath", () => {
  it("finds a chromium build in a shared browser cache", () => {
    const exe = join(dir, "chromium-1194", "chrome-linux", "chrome");
    mkdirSync(join(dir, "chromium-1194", "chrome-linux"), { recursive: true });
    writeFileSync(exe, "");
    expect(discoverBrowserPath(dir)).toBe(exe);
  });

  it("prefers the newest build, numerically not lexically", () => {
    for (const build of ["chromium-998", "chromium-1194"]) {
      mkdirSync(join(dir, build, "chrome-linux"), { recursive: true });
      writeFileSync(join(dir, build, "chrome-linux", "chrome"), "");
    }
    expect(discoverBrowserPath(dir)).toContain("chromium-1194");
  });

  it("falls back to a headless shell build", () => {
    const exe = join(
      dir,
      "chromium_headless_shell-1194",
      "chrome-linux",
      "headless_shell",
    );
    mkdirSync(join(dir, "chromium_headless_shell-1194", "chrome-linux"), {
      recursive: true,
    });
    writeFileSync(exe, "");
    expect(discoverBrowserPath(dir)).toBe(exe);
  });

  it("returns undefined for a directory with no browsers", () => {
    expect(discoverBrowserPath(dir)).toBeUndefined();
  });

  it("returns undefined for a directory that does not exist", () => {
    expect(discoverBrowserPath(join(dir, "nope"))).toBeUndefined();
  });
});

describe("scanInBrowser", () => {
  it("reports honestly rather than throwing when no browser can be launched", async () => {
    const result = await scanInBrowser({
      url: "http://127.0.0.1:1",
      routes: ["/"],
      browserPath: join(dir, "not-a-real-browser"),
    });

    expect(result.ran).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.domIds).toEqual([]);
    expect(result.routesVisited).toBe(0);
  });

  it("survives a route that cannot be reached", async () => {
    // A launchable browser with an unreachable app must produce an empty scan,
    // not an exception — `verify` degrades to the server-side basis instead.
    const result = await scanInBrowser({
      url: "http://127.0.0.1:1",
      routes: ["/"],
      timeoutMs: 2_000,
    });
    expect(result.domIds).toEqual([]);
  });
});
