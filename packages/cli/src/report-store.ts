/**
 * Persists the last `verify` run so `report` can print it without re-running
 * anything — which is the whole point of having both commands.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { VerifyResult } from "./commands/verify.js";

export const REPORT_DIR = ".groundtrace";
export const REPORT_FILE = "last-verify.json";

export function reportPath(cwd: string): string {
  return join(cwd, REPORT_DIR, REPORT_FILE);
}

export function saveVerifyResult(cwd: string, result: VerifyResult): string {
  const path = reportPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  // The raw test output can be large and isn't worth persisting.
  const trimmed: VerifyResult = {
    ...result,
    tests: { ...result.tests, raw: result.tests.raw.slice(-800) },
    build: { ...result.build, tail: result.build.tail.slice(-800) },
  };
  writeFileSync(path, `${JSON.stringify(trimmed, null, 2)}\n`, "utf-8");
  return path;
}

export function loadVerifyResult(cwd: string): VerifyResult | undefined {
  const path = reportPath(cwd);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as VerifyResult;
  } catch {
    return undefined;
  }
}
