import { describe, expect, it } from "vitest";
import { classifyValue } from "./classify.js";
import type { ClientNodeEvent, ServerTrace } from "./events.js";
import { applySafetyToValues, isSampled, redactValue, resolveSafety } from "./redact.js";

describe("resolveSafety", () => {
  it("records everything in dev", () => {
    const safety = resolveSafety({ mode: "dev" });
    expect(safety.enabled).toBe(true);
    expect(safety.sampleRate).toBe(1);
    expect(safety.redact).toBe(false);
  });

  it("is OFF by default in production — reaching prod with tracing silently live is the failure mode", () => {
    const safety = resolveSafety({ mode: "production" });
    expect(safety.enabled).toBe(false);
    expect(safety.sampleRate).toBe(0);
  });

  it("redacts by default once production is explicitly enabled", () => {
    const safety = resolveSafety({ mode: "production", sampleRate: 0.1 });
    expect(safety.enabled).toBe(true);
    expect(safety.redact).toBe(true);
  });

  it("records nothing at all when off", () => {
    expect(resolveSafety({ mode: "off" }).enabled).toBe(false);
  });

  it("clamps a nonsense sample rate", () => {
    expect(resolveSafety({ mode: "dev", sampleRate: 5 }).sampleRate).toBe(1);
    expect(resolveSafety({ mode: "dev", sampleRate: -1 }).sampleRate).toBe(0);
    expect(resolveSafety({ mode: "dev", sampleRate: Number.NaN }).sampleRate).toBe(0);
  });
});

describe("isSampled", () => {
  it("takes everything at 1 and nothing at 0", () => {
    expect(isSampled("gt_x", 1)).toBe(true);
    expect(isSampled("gt_x", 0)).toBe(false);
  });

  it("is deterministic per trace id, so client and server agree", () => {
    for (const id of ["gt_a", "gt_b", "gt_c"]) {
      expect(isSampled(id, 0.5)).toBe(isSampled(id, 0.5));
    }
  });

  it("samples roughly the requested share", () => {
    const ids = Array.from({ length: 2_000 }, (_x, index) => `gt_${index}`);
    const taken = ids.filter((id) => isSampled(id, 0.25)).length / ids.length;
    expect(taken).toBeGreaterThan(0.18);
    expect(taken).toBeLessThan(0.32);
  });
});

describe("redactValue", () => {
  it("keeps the shape and drops the contents", () => {
    const redacted = redactValue(184_293);
    expect(redacted.redacted).toBe(true);
    expect(redacted.type).toBe("number");
    expect(JSON.stringify(redacted)).not.toContain("184293");
  });

  it("gives equal values equal digests, and different values different ones", () => {
    expect(redactValue(42).digest).toBe(redactValue(42).digest);
    expect(redactValue(42).digest).not.toBe(redactValue(43).digest);
  });

  it("records magnitude rather than the figure", () => {
    expect(redactValue(184_293).size).toBe(5);
    expect(redactValue(0).size).toBe(0);
  });

  it("handles strings, arrays and objects", () => {
    expect(redactValue("hello").size).toBe(5);
    expect(redactValue([1, 2, 3]).type).toBe("array");
    expect(redactValue({ a: 1 }).type).toBe("object");
    expect(redactValue(null).type).toBe("null");
  });
});

describe("classification survives redaction", () => {
  const traces: ServerTrace[] = [
    {
      traceId: "gt_1",
      route: "/api/revenue",
      startedAt: 1,
      events: [
        {
          sourceId: "revenue-query",
          status: "VERIFIED",
          timestamp: 2,
          produces: ["revenue"],
          values: applySafetyToValues(
            { revenue: 96_159 },
            resolveSafety({ mode: "production", sampleRate: 1 }),
          ),
        },
      ],
    },
  ];

  it("still proves a passthrough against a redacted source value", () => {
    const nodes: ClientNodeEvent[] = [
      {
        id: "revenue",
        value: 96_159,
        source: "/api/revenue",
        traceId: "gt_1",
        capturedAt: 3,
      },
    ];
    const result = classifyValue("revenue", { nodes, traces });
    expect(result.status).toBe("VERIFIED");
    expect(result.reason).toContain("matches what it returned");
  });

  it("still catches a value that does not match its source", () => {
    const nodes: ClientNodeEvent[] = [
      {
        id: "revenue",
        value: 184_293,
        source: "/api/revenue",
        traceId: "gt_1",
        capturedAt: 3,
      },
    ];
    expect(classifyValue("revenue", { nodes, traces }).status).toBe("INDIRECT");
  });

  it("never leaks the real figure into the recorded trace", () => {
    expect(JSON.stringify(traces)).not.toContain("96159");
  });
});
