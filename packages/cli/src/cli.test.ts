import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_COMMAND, mergeStopHook, type ClaudeSettings } from "./claude-hook.js";
import { CONFIG_FILENAME, DEFAULT_CONFIG, loadConfig, saveConfig } from "./config.js";
import { extractFallbackLiterals, extractIds, scanProject } from "./scan.js";
import {
  CLAUDE_SETTINGS_PATH,
  detectConfig,
  runInit,
  writeClaudeHook,
} from "./commands/init.js";
import { injectOverlayTag, startCollectorServer, OVERLAY_PATH } from "./server.js";
import { loadVerifyResult, saveVerifyResult } from "./report-store.js";
import type { VerifyResult } from "./commands/verify.js";
import { formatVerify, verifyExitCode } from "./commands/verify.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "groundtrace-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// --- config ---------------------------------------------------------------

describe("config", () => {
  it("falls back to working defaults when there is no config file", () => {
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips through disk", () => {
    saveConfig(dir, { ...DEFAULT_CONFIG, port: 9999, routes: ["/dashboard"] });
    const loaded = loadConfig(dir);
    expect(loaded.port).toBe(9999);
    expect(loaded.routes).toEqual(["/dashboard"]);
  });

  it("fills in missing keys from the defaults", () => {
    writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify({ port: 1234 }));
    const loaded = loadConfig(dir);
    expect(loaded.port).toBe(1234);
    expect(loaded.build).toBe(DEFAULT_CONFIG.build);
  });

  it("says which file is broken rather than silently using defaults", () => {
    writeFileSync(join(dir, CONFIG_FILENAME), "{ not json");
    expect(() => loadConfig(dir)).toThrow(CONFIG_FILENAME);
  });

  it("detects the project's own scripts", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { dev: "next dev", build: "next build", test: "vitest" },
      }),
    );
    const config = detectConfig(dir);
    expect(config.dev).toBe("npm run dev");
    expect(config.build).toBe("npm run build");
    expect(config.test).toBe("npm test");
  });

  it("keeps defaults when package.json can't be parsed", () => {
    writeFileSync(join(dir, "package.json"), "{{{");
    expect(detectConfig(dir).dev).toBe(DEFAULT_CONFIG.dev);
  });
});

// --- init -----------------------------------------------------------------

describe("init", () => {
  it("writes a config file", () => {
    const result = runInit({ cwd: dir, quiet: true });
    expect(result.configWritten).toBe(true);
    expect(existsSync(result.configPath)).toBe(true);
  });

  it("is idempotent — a second run leaves the config alone", () => {
    runInit({ cwd: dir, quiet: true });
    writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify({ port: 4321 }));
    runInit({ cwd: dir, quiet: true });
    expect(loadConfig(dir).port).toBe(4321);
  });

  it("overwrites only when asked", () => {
    writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify({ port: 4321 }));
    runInit({ cwd: dir, quiet: true, force: true });
    expect(loadConfig(dir).port).toBe(DEFAULT_CONFIG.port);
  });
});

// --- §8 Claude Code hook --------------------------------------------------

describe("mergeStopHook", () => {
  it("creates the hooks structure from nothing", () => {
    const merged = mergeStopHook(undefined);
    expect(merged.hooks?.["Stop"]?.[0]?.hooks?.[0]).toEqual({
      type: "command",
      command: HOOK_COMMAND,
    });
  });

  it("leaves an unrelated PostToolUse hook completely intact", () => {
    const existing: ClaudeSettings = {
      hooks: {
        PostToolUse: [
          { matcher: "Write", hooks: [{ type: "command", command: "prettier" }] },
        ],
      },
      permissions: { allow: ["Bash(npm test)"] },
    };

    const merged = mergeStopHook(existing);
    expect(merged.hooks?.["PostToolUse"]).toEqual(existing.hooks?.["PostToolUse"]);
    expect(merged["permissions"]).toEqual(existing["permissions"]);
    expect(merged.hooks?.["Stop"]).toHaveLength(1);
  });

  it("appends to an existing Stop hook instead of clobbering it", () => {
    const existing: ClaudeSettings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
    };

    const merged = mergeStopHook(existing);
    const commands = merged.hooks?.["Stop"]?.[0]?.hooks?.map((hook) => hook.command);
    expect(commands).toEqual(["say done", HOOK_COMMAND]);
  });

  it("does not add itself twice", () => {
    const once = mergeStopHook(undefined);
    const twice = mergeStopHook(once);
    expect(twice.hooks?.["Stop"]?.[0]?.hooks).toHaveLength(1);
  });

  it("uses `|| true` so an unrelated failure can't break Claude's stop flow", () => {
    expect(HOOK_COMMAND).toContain("|| true");
  });
});

describe("writeClaudeHook", () => {
  it("creates .claude/settings.json with valid JSON when nothing exists", () => {
    const { path, written } = writeClaudeHook(dir);
    expect(written).toBe(true);
    expect(path).toBe(join(dir, CLAUDE_SETTINGS_PATH));

    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ClaudeSettings;
    expect(parsed.hooks?.["Stop"]?.[0]?.hooks?.[0]?.command).toBe(HOOK_COMMAND);
  });

  it("preserves an unrelated hook already in the file", () => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, CLAUDE_SETTINGS_PATH),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Edit", hooks: [{ type: "command", command: "eslint --fix" }] },
          ],
        },
      }),
    );

    writeClaudeHook(dir);
    const parsed = JSON.parse(
      readFileSync(join(dir, CLAUDE_SETTINGS_PATH), "utf-8"),
    ) as ClaudeSettings;

    expect(parsed.hooks?.["PostToolUse"]?.[0]?.hooks?.[0]?.command).toBe("eslint --fix");
    expect(parsed.hooks?.["Stop"]?.[0]?.hooks?.[0]?.command).toBe(HOOK_COMMAND);
  });

  it("refuses to overwrite a settings file it cannot parse", () => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, CLAUDE_SETTINGS_PATH), "{ broken");
    expect(() => writeClaudeHook(dir)).toThrow("refusing to overwrite");
  });

  it("is a no-op the second time", () => {
    writeClaudeHook(dir);
    expect(writeClaudeHook(dir).written).toBe(false);
  });
});

// --- scan -----------------------------------------------------------------

describe("scan", () => {
  it("finds data-truth-id attributes", () => {
    expect(extractIds('<span data-truth-id="revenue">{x}</span>')).toEqual(["revenue"]);
  });

  it("finds ids passed to useTruthValue", () => {
    const source = `const v = useTruthValue(x, { id: "revenue", source: "/api/y" });`;
    expect(extractIds(source)).toContain("revenue");
  });

  it("ignores `id:` keys in files that never call the SDK", () => {
    expect(extractIds(`const user = { id: "not-a-tracked-value" };`)).toEqual([]);
  });

  it("pulls numbers out of constants that announce they are fake", () => {
    const source = `const DEMO_FALLBACK = { revenue: 184_293, growth: 0.248, customers: 14293 };`;
    expect(extractFallbackLiterals(source)).toEqual([184293, 0.248, 14293]);
  });

  it("leaves ordinary constants alone", () => {
    expect(extractFallbackLiterals(`const TAX_RATE = 0.2;`)).toEqual([]);
  });

  it("walks a project directory", () => {
    mkdirSync(join(dir, "app", "nested"), { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "app", "page.tsx"), '<b data-truth-id="revenue">x</b>');
    writeFileSync(
      join(dir, "app", "nested", "card.tsx"),
      '<b data-truth-id="customers">x</b>',
    );
    writeFileSync(
      join(dir, "node_modules", "junk.tsx"),
      '<b data-truth-id="ignored">x</b>',
    );

    const result = scanProject(dir, ["app", "does-not-exist"]);
    expect(result.trackedIds).toEqual(["customers", "revenue"]);
    expect(result.files).toBe(2);
  });
});

// --- overlay injection ----------------------------------------------------

describe("injectOverlayTag", () => {
  it("adds the script before </head>", () => {
    const html = injectOverlayTag(
      "<html><head><title>x</title></head><body></body></html>",
    );
    expect(html).toContain(OVERLAY_PATH);
    expect(html.indexOf(OVERLAY_PATH)).toBeLessThan(html.indexOf("</head>"));
  });

  it("falls back to </body> when there is no head", () => {
    const html = injectOverlayTag("<html><body><p>x</p></body></html>");
    expect(html.indexOf(OVERLAY_PATH)).toBeLessThan(html.indexOf("</body>"));
  });

  it("appends when the markup has neither", () => {
    expect(injectOverlayTag("<p>x</p>")).toContain(OVERLAY_PATH);
  });

  it("does not inject twice", () => {
    const once = injectOverlayTag("<html><head></head></html>");
    const twice = injectOverlayTag(once);
    expect(twice).toBe(once);
  });
});

// --- collector server -----------------------------------------------------

describe("collector server", () => {
  it("serves the collector API and the overlay bundle over HTTP", async () => {
    const collector = await startCollectorServer({ port: 0 });
    try {
      const health = await fetch(`${collector.url}/__groundtrace/health`);
      expect(health.status).toBe(200);

      const post = await fetch(`${collector.url}/__groundtrace/nodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { id: "revenue", value: 1, source: "/api/revenue", capturedAt: Date.now() },
        ]),
      });
      expect(post.status).toBe(202);

      const report = await fetch(`${collector.url}/__groundtrace/report`);
      expect(((await report.json()) as { tracked: number }).tracked).toBe(1);

      const overlay = await fetch(`${collector.url}${OVERLAY_PATH}`);
      expect(overlay.status).toBe(200);
      expect(await overlay.text()).toContain("groundtrace");
    } finally {
      await collector.close();
    }
  });

  it("rejects a malformed body instead of crashing", async () => {
    const collector = await startCollectorServer({ port: 0 });
    try {
      const response = await fetch(`${collector.url}/__groundtrace/nodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      });
      expect(response.status).toBe(400);
    } finally {
      await collector.close();
    }
  });

  it("404s outside the collector when there is nothing to proxy to", async () => {
    const collector = await startCollectorServer({ port: 0 });
    try {
      expect((await fetch(`${collector.url}/anything`)).status).toBe(404);
    } finally {
      await collector.close();
    }
  });
});

// --- report persistence ---------------------------------------------------

function sampleResult(confidence: number | null): VerifyResult {
  return {
    build: { command: "next build", ran: true, exitCode: 0, tail: "" },
    tests: {
      command: "vitest run",
      exitCode: 0,
      executed: true,
      runner: "vitest",
      testsDiscovered: 12,
      testsPassed: 12,
      testsFailed: null,
      raw: "",
    },
    provenance: {
      ran: true,
      routesExercised: 1,
      idsFromSource: 3,
      report: {
        values: [
          {
            id: "revenue",
            status: "FALLBACK",
            value: 184293,
            source: "/api/revenue",
            reason: "the API failed — this value is not backed by live data",
            tree: { label: "revenue", status: "FALLBACK", children: [] },
            capturedAt: 1,
          },
        ],
        tracked: 3,
        counts: { VERIFIED: 2, INDIRECT: 0, FALLBACK: 1, SYNTHETIC: 0, UNTRACED: 0 },
        confidence,
        generatedAt: 1,
      },
    },
    generatedAt: 1,
  };
}

describe("report persistence", () => {
  it("survives a round trip to disk", () => {
    saveVerifyResult(dir, sampleResult(2 / 3));
    expect(loadVerifyResult(dir)?.provenance.report?.tracked).toBe(3);
  });

  it("returns undefined when nothing has been saved", () => {
    expect(loadVerifyResult(dir)).toBeUndefined();
  });
});

// --- the verification box -------------------------------------------------

describe("formatVerify", () => {
  it("prints the pitch's report box and names the flagged value", () => {
    const report = formatVerify(sampleResult(2 / 3));
    expect(report).toContain("GROUNDTRACE VERIFICATION");
    expect(report).toContain("Tracked values   3");
    expect(report).toContain("Verified");
    expect(report).toContain("Fallback");
    expect(report).toContain("revenue");
    expect(report).toContain("67%");
  });

  it("says the scan didn't run rather than inventing a confidence figure", () => {
    const result = sampleResult(1);
    result.provenance = {
      ran: false,
      skipped: "the app never became reachable at http://127.0.0.1:3000",
      routesExercised: 0,
      idsFromSource: 3,
    };
    const report = formatVerify(result);
    expect(report).toContain("not scanned");
    expect(report).toContain("unknown");
    expect(report).not.toContain("100%");
  });
});

describe("verifyExitCode", () => {
  it("is 0 when everything checks out", () => {
    const clean = sampleResult(1);
    clean.provenance.report!.counts = {
      VERIFIED: 3,
      INDIRECT: 0,
      FALLBACK: 0,
      SYNTHETIC: 0,
      UNTRACED: 0,
    };
    expect(verifyExitCode(clean)).toBe(0);
  });

  it("is non-zero when confidence is below 100%", () => {
    expect(verifyExitCode(sampleResult(2 / 3))).toBe(1);
  });

  it("is non-zero when the build failed", () => {
    const broken = sampleResult(1);
    broken.build.exitCode = 1;
    expect(verifyExitCode(broken)).toBe(1);
  });

  it("does not fail on a scan that never ran", () => {
    const result = sampleResult(1);
    result.provenance = {
      ran: false,
      skipped: "app unreachable",
      routesExercised: 0,
      idsFromSource: 0,
    };
    expect(verifyExitCode(result)).toBe(0);
  });
});
