import { describe, expect, it } from "vitest";
import {
  detectRunner,
  formatEvidence,
  parseCounts,
  statusOf,
  verifyTests,
  type TestEvidence,
} from "./verify-tests.js";

const PYTEST_PASS = `============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-8.2.0, pluggy-1.5.0
collected 27 items

tests/test_orders.py ...........................                         [100%]

============================== 27 passed in 0.12s ==============================
`;

const PYTEST_FAIL = `============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-8.2.0, pluggy-1.5.0
collected 27 items

tests/test_orders.py ....F..F..F................                         [100%]

=========================== short test summary info ============================
FAILED tests/test_orders.py::test_total - assert 184293 == 0
========================= 3 failed, 24 passed in 0.31s =========================
`;

const PYTEST_NO_COLLECTED_LINE = `=================== 5 passed, 1 failed in 0.04s ====================`;

const VITEST_PASS = ` ✓ src/classify.test.ts (12 tests) 8ms

 Test Files  3 passed (3)
      Tests  27 passed (27)
   Start at  11:04:02
   Duration  1.20s
`;

const VITEST_FAIL = ` ❯ src/classify.test.ts (12 tests | 3 failed) 14ms

 Test Files  1 failed | 2 passed (3)
      Tests  3 failed | 24 passed (27)
   Start at  11:04:02
   Duration  1.31s
`;

const JEST_PASS = `Test Suites: 3 passed, 3 total
Tests:       27 passed, 27 total
Snapshots:   0 total
Time:        1.204 s
`;

const JEST_FAIL = `Test Suites: 1 failed, 2 passed, 3 total
Tests:       3 failed, 24 passed, 27 total
Snapshots:   0 total
Time:        1.311 s
`;

describe("detectRunner", () => {
  it("tells the three supported runners apart", () => {
    expect(detectRunner(PYTEST_PASS)).toBe("pytest");
    expect(detectRunner(VITEST_PASS)).toBe("vitest");
    expect(detectRunner(JEST_PASS)).toBe("jest");
  });

  it("does not confuse jest's summary for vitest's", () => {
    expect(detectRunner(JEST_FAIL)).toBe("jest");
    expect(detectRunner(VITEST_FAIL)).toBe("vitest");
  });

  it("returns unknown for output from something that isn't a test runner", () => {
    expect(detectRunner("hi\n")).toBe("unknown");
    expect(detectRunner("")).toBe("unknown");
  });
});

describe("parseCounts — pytest", () => {
  it("reads a clean run", () => {
    expect(parseCounts(PYTEST_PASS)).toEqual({
      runner: "pytest",
      testsDiscovered: 27,
      testsPassed: 27,
      testsFailed: null,
    });
  });

  it("reads a failing run", () => {
    expect(parseCounts(PYTEST_FAIL)).toEqual({
      runner: "pytest",
      testsDiscovered: 27,
      testsPassed: 24,
      testsFailed: 3,
    });
  });

  it("derives the discovered count when pytest omits the collected line", () => {
    expect(parseCounts(PYTEST_NO_COLLECTED_LINE)).toEqual({
      runner: "pytest",
      testsDiscovered: 6,
      testsPassed: 5,
      testsFailed: 1,
    });
  });
});

describe("parseCounts — vitest", () => {
  it("reads a clean run", () => {
    expect(parseCounts(VITEST_PASS)).toEqual({
      runner: "vitest",
      testsDiscovered: 27,
      testsPassed: 27,
      testsFailed: null,
    });
  });

  it("reads a failing run without mistaking the failed count for the passed one", () => {
    expect(parseCounts(VITEST_FAIL)).toEqual({
      runner: "vitest",
      testsDiscovered: 27,
      testsPassed: 24,
      testsFailed: 3,
    });
  });
});

describe("parseCounts — jest", () => {
  it("reads a clean run", () => {
    expect(parseCounts(JEST_PASS)).toEqual({
      runner: "jest",
      testsDiscovered: 27,
      testsPassed: 27,
      testsFailed: null,
    });
  });

  it("reads a failing run", () => {
    expect(parseCounts(JEST_FAIL)).toEqual({
      runner: "jest",
      testsDiscovered: 27,
      testsPassed: 24,
      testsFailed: 3,
    });
  });
});

describe("parseCounts — unparseable output", () => {
  it("reports nulls rather than inventing numbers", () => {
    expect(parseCounts("hi\n")).toEqual({
      runner: "unknown",
      testsDiscovered: null,
      testsPassed: null,
      testsFailed: null,
    });
  });
});

function evidence(overrides: Partial<TestEvidence> = {}): TestEvidence {
  return {
    command: "pytest",
    exitCode: 0,
    executed: true,
    runner: "pytest",
    testsDiscovered: 27,
    testsPassed: 27,
    testsFailed: null,
    raw: PYTEST_PASS,
    ...overrides,
  };
}

describe("statusOf", () => {
  it("is VERIFIED only when the run exited clean AND a pass count was proven", () => {
    expect(statusOf(evidence())).toBe("VERIFIED");
  });

  it("is UNVERIFIED on a non-zero exit", () => {
    expect(statusOf(evidence({ exitCode: 1, testsPassed: 24, testsFailed: 3 }))).toBe(
      "UNVERIFIED",
    );
  });

  it("is UNVERIFIED when the command never started", () => {
    expect(statusOf(evidence({ executed: false, exitCode: -1 }))).toBe("UNVERIFIED");
  });

  it("is INCONCLUSIVE when the command exited clean but proved no tests", () => {
    expect(
      statusOf(
        evidence({
          runner: "unknown",
          testsDiscovered: null,
          testsPassed: null,
          raw: "hi",
        }),
      ),
    ).toBe("INCONCLUSIVE");
  });
});

describe("formatEvidence", () => {
  it("renders the TEST CLAIM box for a verified run", () => {
    const report = formatEvidence(evidence());
    expect(report).toContain("TEST CLAIM");
    expect(report).toContain("Command:  pytest");
    expect(report).toContain("27 discovered");
    expect(report).toContain("27 passed");
    expect(report).toContain("VERIFIED");
  });

  it("names the real failure count for an unverified run", () => {
    const report = formatEvidence(
      evidence({ exitCode: 1, testsPassed: 24, testsFailed: 3, raw: PYTEST_FAIL }),
    );
    expect(report).toContain("exit code 1");
    expect(report).toContain("UNVERIFIED");
    expect(report).toContain("3 failures in the raw output below");
  });

  it("never fabricates a count when nothing was parseable", () => {
    const report = formatEvidence(
      evidence({
        runner: "unknown",
        testsDiscovered: null,
        testsPassed: null,
        raw: "hi",
      }),
    );
    expect(report).toContain("count not parsed");
    expect(report).not.toMatch(/\d+ passed/);
  });
});

describe("verifyTests — real subprocess execution", () => {
  it("captures a real exit code and real output", () => {
    const result = verifyTests("echo hi");
    expect(result.executed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.raw).toContain("hi");
    expect(result.testsDiscovered).toBeNull();
    expect(result.testsPassed).toBeNull();
    expect(statusOf(result)).toBe("INCONCLUSIVE");
  });

  it("captures a non-zero exit honestly", () => {
    const result = verifyTests("exit 3");
    expect(result.exitCode).toBe(3);
    expect(statusOf(result)).toBe("UNVERIFIED");
  });

  it("does not crash when the command does not exist", () => {
    const result = verifyTests("groundtrace-definitely-not-a-real-binary");
    expect(result.exitCode).not.toBe(0);
    expect(statusOf(result)).toBe("UNVERIFIED");
  });
});
