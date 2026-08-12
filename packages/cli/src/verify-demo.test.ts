/**
 * BUILD_SPEC §7's required integration test: run `groundtrace verify` against
 * the §6 demo in both toggle states and confirm the confidence number moves.
 *
 * This is the slowest test in the repo — it starts a real Next dev server twice
 * — but it is the only one that exercises the whole pipeline end to end through
 * the actual CLI entry point. Set `GROUNDTRACE_SKIP_E2E=1` to skip it.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runVerify, formatVerify, verifyExitCode } from "./commands/verify.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEMO = resolve(here, "../../../examples/dashboard-demo");

const skip =
  process.env["GROUNDTRACE_SKIP_E2E"] === "1" ||
  !existsSync(resolve(DEMO, "package.json"));

/**
 * The demo defaults to the failure state and reads `SIMULATE_API_FAILURE` from
 * its environment, which `verify` passes down to the app it spawns.
 */
async function verifyDemo(simulateFailure: boolean, appPort: number) {
  const previous = process.env["SIMULATE_API_FAILURE"];
  process.env["SIMULATE_API_FAILURE"] = simulateFailure ? "true" : "false";

  try {
    return await runVerify({
      cwd: DEMO,
      quiet: true,
      skipBuild: true,
      skipTests: true,
      configOverrides: { appPort },
    });
  } finally {
    if (previous === undefined) delete process.env["SIMULATE_API_FAILURE"];
    else process.env["SIMULATE_API_FAILURE"] = previous;
  }
}

describe.skipIf(skip)("groundtrace verify against the reference demo", () => {
  it(
    "reports 0% confidence and names revenue when the API failure is simulated",
    { timeout: 240_000 },
    async () => {
      const result = await verifyDemo(true, 3101);

      expect(result.provenance.ran).toBe(true);
      const report = result.provenance.report!;

      expect(report.tracked).toBe(3);
      expect(report.counts.FALLBACK).toBe(3);
      expect(report.confidence).toBe(0);

      const revenue = report.values.find((value) => value.id === "revenue");
      expect(revenue?.status).toBe("FALLBACK");
      expect(revenue?.reason).toContain("not backed by live data");

      // §7's acceptance criterion is about the printed box, so assert on that.
      const printed = formatVerify(result);
      expect(printed).toContain("GROUNDTRACE VERIFICATION");
      expect(printed).toContain("revenue");
      expect(printed).toContain("0%");
      expect(printed).not.toContain("100%");

      expect(verifyExitCode(result)).toBe(1);
    },
  );

  it(
    "reports 100% confidence with the failure switched off",
    { timeout: 240_000 },
    async () => {
      const result = await verifyDemo(false, 3102);

      expect(result.provenance.ran).toBe(true);
      const report = result.provenance.report!;

      expect(report.tracked).toBe(3);
      expect(report.counts.FALLBACK).toBe(0);
      expect(report.confidence).toBe(1);

      const revenue = report.values.find((value) => value.id === "revenue");
      expect(revenue?.status).toBe("VERIFIED");

      expect(formatVerify(result)).toContain("100%");
      expect(verifyExitCode(result)).toBe(0);
    },
  );

  it(
    "proves the displayed value against the source when a browser is available",
    { timeout: 240_000 },
    async () => {
      const result = await verifyDemo(false, 3103);
      const revenue = result.provenance.report!.values.find(
        (value) => value.id === "revenue",
      );

      if (result.provenance.basis === "dom") {
        // V2_SPEC §10: a real render is the only basis on which the displayed
        // number can be *proven* to match its source.
        expect(revenue?.reason).toContain("matches what it returned");
        expect(formatVerify(result)).toContain("rendered in a browser");
      } else {
        // No browser here — the weaker basis must be stated, not glossed over.
        expect(formatVerify(result)).toContain("server side only");
      }
    },
  );

  it(
    "still works with the real-DOM scan explicitly disabled",
    { timeout: 240_000 },
    async () => {
      const previous = process.env["SIMULATE_API_FAILURE"];
      process.env["SIMULATE_API_FAILURE"] = "true";
      try {
        const result = await runVerify({
          cwd: DEMO,
          quiet: true,
          skipBuild: true,
          skipTests: true,
          noBrowser: true,
          configOverrides: { appPort: 3104 },
        });

        expect(result.provenance.basis).toBe("inferred");
        expect(result.provenance.report?.counts.FALLBACK).toBe(3);
        expect(formatVerify(result)).toContain("server side only");
      } finally {
        if (previous === undefined) delete process.env["SIMULATE_API_FAILURE"];
        else process.env["SIMULATE_API_FAILURE"] = previous;
      }
    },
  );
});
