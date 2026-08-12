/**
 * `groundtrace verify-tests -- <command>`
 *
 * The smallest useful version of "verify, don't trust the claim": run the test
 * command yourself, capture what actually happened, and report only what the
 * output proves. When a count can't be parsed we say so — we never invent one.
 */
import { spawnSync } from "node:child_process";
import { box, cross, paint, tick, unknown } from "../ui.js";

export type TestRunner = "pytest" | "vitest" | "jest" | "unknown";

export type TestClaimStatus = "VERIFIED" | "UNVERIFIED" | "INCONCLUSIVE";

export interface TestEvidence {
  command: string;
  /** Process exit code. `-1` means the command never started (e.g. ENOENT). */
  exitCode: number;
  /** False when the process could not be spawned at all. */
  executed: boolean;
  runner: TestRunner;
  testsDiscovered: number | null;
  testsPassed: number | null;
  testsFailed: number | null;
  /** Last ~2000 chars of combined stdout+stderr, for the report. */
  raw: string;
}

const MAX_RAW = 2000;

/**
 * Every parser below deliberately matches a *summary* line rather than counting
 * per-test output — summaries are stable across versions, per-test formatting
 * is not.
 */
interface ParserSpec {
  runner: Exclude<TestRunner, "unknown">;
  /** Does this output look like it came from this runner at all? */
  detect: RegExp;
  passed: RegExp[];
  failed: RegExp[];
  discovered: RegExp[];
}

const PARSERS: ParserSpec[] = [
  {
    runner: "vitest",
    // Vitest and Jest both print a "Tests" summary; Vitest's uses `|` separators
    // and a parenthesised total, Jest's uses commas and the word "total".
    detect: /Tests\s+.*\(\d+\)|Test Files\s+/,
    passed: [/Tests\s+(?:\d+\s+failed\s*\|\s*)?(\d+)\s+passed/],
    failed: [/Tests\s+(\d+)\s+failed/],
    discovered: [/Tests\s+.*\((\d+)\)/],
  },
  {
    runner: "jest",
    detect: /Tests:\s+.*\d+\s+total/,
    passed: [/Tests:.*?(\d+)\s+passed/],
    failed: [/Tests:.*?(\d+)\s+failed/],
    discovered: [/Tests:.*?(\d+)\s+total/],
  },
  {
    runner: "pytest",
    detect:
      /=+\s*(?:test session starts|\d+\s+(?:passed|failed|error))|collected\s+\d+\s+item/,
    passed: [/(\d+)\s+passed/],
    failed: [/(\d+)\s+failed/, /(\d+)\s+error(?:s)?\b/],
    discovered: [/collected\s+(\d+)\s+item/],
  },
];

function firstMatch(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function detectRunner(output: string): TestRunner {
  for (const spec of PARSERS) {
    if (spec.detect.test(output)) return spec.runner;
  }
  return "unknown";
}

export interface ParsedCounts {
  runner: TestRunner;
  testsDiscovered: number | null;
  testsPassed: number | null;
  testsFailed: number | null;
}

export function parseCounts(output: string): ParsedCounts {
  const runner = detectRunner(output);
  const spec = PARSERS.find((candidate) => candidate.runner === runner);
  if (!spec) {
    return {
      runner,
      testsDiscovered: null,
      testsPassed: null,
      testsFailed: null,
    };
  }

  const testsPassed = firstMatch(output, spec.passed);
  const testsFailed = firstMatch(output, spec.failed);
  let testsDiscovered = firstMatch(output, spec.discovered);

  // pytest only prints "collected N items" in non-quiet mode. When it doesn't,
  // passed + failed is a *derived* count, not an invented one.
  if (testsDiscovered === null && (testsPassed !== null || testsFailed !== null)) {
    testsDiscovered = (testsPassed ?? 0) + (testsFailed ?? 0);
  }

  return { runner, testsDiscovered, testsPassed, testsFailed };
}

export function verifyTests(command: string): TestEvidence {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  const executed = result.error === undefined && result.status !== null;
  const counts = parseCounts(combined);

  return {
    command,
    exitCode: result.status ?? -1,
    executed,
    runner: counts.runner,
    testsDiscovered: counts.testsDiscovered,
    testsPassed: counts.testsPassed,
    testsFailed: counts.testsFailed,
    raw: combined.slice(-MAX_RAW),
  };
}

export function statusOf(evidence: TestEvidence): TestClaimStatus {
  if (!evidence.executed || evidence.exitCode !== 0) return "UNVERIFIED";
  // Exit code 0 with nothing parseable is honest evidence that *something* ran
  // successfully — but it is not evidence that any test did.
  if (evidence.testsPassed === null) return "INCONCLUSIVE";
  return "VERIFIED";
}

function evidenceLine(evidence: TestEvidence): string {
  const parts: string[] = [];
  parts.push(evidence.executed ? tick("executed") : cross("did not execute"));

  if (evidence.executed) {
    parts.push(
      evidence.exitCode === 0
        ? tick(`exit code ${evidence.exitCode}`)
        : cross(`exit code ${evidence.exitCode}`),
    );
  }

  if (evidence.testsDiscovered !== null) {
    parts.push(tick(`${evidence.testsDiscovered} discovered`));
  } else if (evidence.executed) {
    parts.push(unknown("count not parsed"));
  }

  if (evidence.testsPassed !== null) {
    parts.push(tick(`${evidence.testsPassed} passed`));
  }
  if (evidence.testsFailed) {
    parts.push(cross(`${evidence.testsFailed} failed`));
  }

  return parts.join(" · ");
}

function statusLine(evidence: TestEvidence): string {
  const status = statusOf(evidence);
  if (status === "VERIFIED") return paint("VERIFIED", "green");
  if (status === "INCONCLUSIVE") {
    return `${paint("INCONCLUSIVE", "yellow")} — ran clean, but no test counts appeared in the output`;
  }
  if (!evidence.executed) {
    return `${paint("UNVERIFIED", "red")} — the command never ran`;
  }
  const failures = evidence.testsFailed;
  const detail =
    failures !== null && failures > 0
      ? `${failures} failure${failures === 1 ? "" : "s"} in the raw output below`
      : "non-zero exit, see the raw output below";
  return `${paint("UNVERIFIED", "red")} — ${detail}`;
}

export function formatEvidence(evidence: TestEvidence): string {
  const lines = [
    `Command:  ${evidence.command}`,
    `Evidence: ${evidenceLine(evidence)}`,
    `Status:   ${statusLine(evidence)}`,
  ];
  return box("TEST CLAIM", lines, 28);
}

export interface VerifyTestsOptions {
  /** Print the captured output tail. Defaults to on for anything not VERIFIED. */
  showRaw?: boolean;
  quiet?: boolean;
}

/** Runs the command, prints the report, and returns the process exit code to use. */
export function runVerifyTests(
  command: string,
  options: VerifyTestsOptions = {},
): number {
  const evidence = verifyTests(command);
  const status = statusOf(evidence);

  if (!options.quiet) {
    console.log(formatEvidence(evidence));
    const showRaw = options.showRaw ?? status !== "VERIFIED";
    if (showRaw && evidence.raw.trim() !== "") {
      console.log("");
      console.log(paint("── captured output (tail) ──", "gray"));
      console.log(evidence.raw.trimEnd());
    }
  }

  return status === "VERIFIED" ? 0 : 1;
}
