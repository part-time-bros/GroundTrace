import { afterEach, describe, expect, it } from "vitest";
import { classifyValue, type ClientNodeEvent, type ServerTrace } from "@groundtrace/core";
import { startAutoTagging, type AutoHandle } from "./auto.js";
import { indexSourceValues, matchDisplayedValue, parseDisplayedNumber } from "./match.js";

const HEALTHY: ServerTrace[] = [
  {
    traceId: "gt_1",
    route: "/api/revenue",
    startedAt: 1,
    events: [
      {
        sourceId: "revenue-query",
        status: "VERIFIED",
        timestamp: 2,
        kind: "db",
        label: "SELECT SUM(total) AS revenue FROM orders",
        produces: ["revenue", "customers"],
        values: { revenue: 96_159, customers: 29 },
      },
    ],
  },
];

const BROKEN: ServerTrace[] = [
  {
    traceId: "gt_2",
    route: "/api/revenue",
    startedAt: 1,
    events: [
      {
        sourceId: "revenue-fallback",
        status: "FALLBACK_TRIGGERED",
        timestamp: 2,
        kind: "compute",
        label: "catch block returned a hardcoded value",
        detail: "upstream 503",
        produces: ["revenue"],
        values: { revenue: 184_293 },
      },
    ],
  },
];

let handle: AutoHandle | undefined;

afterEach(() => {
  handle?.stop();
  handle = undefined;
  document.body.innerHTML = "";
});

/** A dashboard with zero GroundTrace calls in it. */
function renderPlainDashboard(revenue: string, customers = "29") {
  document.body.innerHTML = `
    <main>
      <div class="card"><div class="label">Total revenue</div><div class="figure">${revenue}</div></div>
      <div class="card"><div class="label">Customers</div><div class="figure">${customers}</div></div>
    </main>
  `;
}

async function tag(traces: ServerTrace[]): Promise<ClientNodeEvent[]> {
  const reported: ClientNodeEvent[] = [];
  handle = startAutoTagging({
    document,
    intervalMs: 1_000_000,
    fetchSnapshot: async () => ({ traces }),
    report: (events) => {
      reported.push(...events);
    },
  });
  await handle.scan();
  return reported;
}

describe("parseDisplayedNumber", () => {
  it("reads the formatting a dashboard actually applies", () => {
    expect(parseDisplayedNumber("$96,159")).toBe(96159);
    expect(parseDisplayedNumber("+18.1%")).toBe(18.1);
    expect(parseDisplayedNumber("29")).toBe(29);
    expect(parseDisplayedNumber(" €1,234.56 ")).toBe(1234.56);
    expect(parseDisplayedNumber("(500)")).toBe(-500);
    expect(parseDisplayedNumber("-12")).toBe(-12);
  });

  it("returns undefined for text that isn't a number", () => {
    expect(parseDisplayedNumber("Total revenue")).toBeUndefined();
    expect(parseDisplayedNumber("")).toBeUndefined();
    expect(parseDisplayedNumber("—")).toBeUndefined();
    expect(parseDisplayedNumber("1.2.3")).toBeUndefined();
  });

  it("ignores text long enough to be prose rather than a value", () => {
    expect(
      parseDisplayedNumber("we made 96159 dollars last quarter, roughly"),
    ).toBeUndefined();
  });
});

describe("matchDisplayedValue", () => {
  it("matches a formatted number back to the source that produced it", () => {
    const index = indexSourceValues(HEALTHY);
    const result = matchDisplayedValue("$96,159", index);
    expect(result?.match.id).toBe("revenue");
    expect(result?.candidates).toBe(1);
  });

  it("reports how many tracked ids share a number", () => {
    const ambiguous: ServerTrace[] = [
      {
        ...HEALTHY[0]!,
        events: [
          {
            ...HEALTHY[0]!.events[0]!,
            values: { revenue: 42, customers: 42 },
          },
        ],
      },
    ];
    const result = matchDisplayedValue("42", indexSourceValues(ambiguous));
    expect(result?.candidates).toBe(2);
  });

  it("prefers a failed source when several could match", () => {
    const index = indexSourceValues([...HEALTHY, ...BROKEN]);
    const mixed: ServerTrace[] = [
      {
        traceId: "gt_3",
        startedAt: 1,
        events: [
          {
            sourceId: "healthy",
            status: "VERIFIED",
            timestamp: 2,
            values: { revenue: 184_293 },
          },
        ],
      },
    ];
    const combined = indexSourceValues([...mixed, ...BROKEN]);
    expect(matchDisplayedValue("184,293", combined)?.match.failed).toBe(true);
    expect(index.size).toBeGreaterThan(0);
  });
});

describe("zero-config tagging", () => {
  it("tags a component that never calls GroundTrace at all", async () => {
    renderPlainDashboard("$96,159");
    const reported = await tag(HEALTHY);

    const revenue = document.querySelector('[data-truth-id="revenue"]');
    expect(revenue?.textContent).toBe("$96,159");
    expect(reported.map((event) => event.id).sort()).toEqual(["customers", "revenue"]);
    expect(reported[0]?.auto).toBe(true);
  });

  it("classifies an auto-tagged value against the real source", async () => {
    renderPlainDashboard("$96,159");
    const reported = await tag(HEALTHY);

    const result = classifyValue("revenue", { nodes: reported, traces: HEALTHY });
    expect(result.status).toBe("VERIFIED");
    expect(result.reason).toContain("matched automatically, not declared");
  });

  it("catches a fallback with no instrumentation in the app", async () => {
    renderPlainDashboard("$184,293", "14,293");
    const reported = await tag(BROKEN);

    const result = classifyValue("revenue", { nodes: reported, traces: BROKEN });
    expect(result.status).toBe("FALLBACK");
    expect(result.reason).toContain("not backed by live data");
  });

  it("never overwrites an explicit data-truth-id", async () => {
    document.body.innerHTML = `<span data-truth-id="declared-by-hand">$96,159</span>`;
    await tag(HEALTHY);
    expect(document.querySelector("span")?.getAttribute("data-truth-id")).toBe(
      "declared-by-hand",
    );
  });

  it("matches a percentage on screen back to the ratio at the source", async () => {
    // The single most common dashboard transform: source returns 0.248, the page
    // renders "+24.8%". Without undoing it, the most-formatted value never matches.
    const ratio: ServerTrace[] = [
      {
        traceId: "gt_pct",
        startedAt: 1,
        events: [
          {
            sourceId: "growth-calc",
            status: "VERIFIED",
            timestamp: 2,
            produces: ["growth"],
            values: { growth: 0.248 },
          },
        ],
      },
    ];

    document.body.innerHTML = `<span>+24.8%</span>`;
    const reported = await tag(ratio);
    expect(reported[0]?.id).toBe("growth");
    expect(document.querySelector("[data-truth-id]")?.getAttribute("data-truth-id")).toBe(
      "growth",
    );
  });

  it("does not undo a percentage for text that carries no percent sign", async () => {
    const ratio: ServerTrace[] = [
      {
        traceId: "gt_pct2",
        startedAt: 1,
        events: [
          {
            sourceId: "q",
            status: "VERIFIED",
            timestamp: 2,
            produces: ["growth"],
            values: { growth: 0.248 },
          },
        ],
      },
    ];
    document.body.innerHTML = `<span>24.8</span>`;
    expect(await tag(ratio)).toEqual([]);
  });

  it("scan() reports the page, not just the delta", async () => {
    renderPlainDashboard("$96,159");
    handle = startAutoTagging({
      document,
      intervalMs: 1_000_000,
      fetchSnapshot: async () => ({ traces: HEALTHY }),
      report: () => undefined,
    });

    const first = await handle.scan();
    const second = await handle.scan();
    // Nothing changed between them, so nothing is re-reported — but both scans
    // still describe the two values that are on the page.
    expect(first.map((event) => event.id).sort()).toEqual(["customers", "revenue"]);
    expect(second.map((event) => event.id).sort()).toEqual(["customers", "revenue"]);
  });

  it("tags only the first element repeating a number, not every one", async () => {
    document.body.innerHTML = `<span>$96,159</span><span>$96,159</span>`;
    await tag(HEALTHY);
    expect(document.querySelectorAll('[data-truth-id="revenue"]')).toHaveLength(1);
  });

  it("ignores containers and labels", async () => {
    renderPlainDashboard("$96,159");
    await tag(HEALTHY);
    expect(document.querySelector("main")?.hasAttribute("data-truth-id")).toBe(false);
    const label = document.querySelector(".label");
    expect(label?.hasAttribute("data-truth-id")).toBe(false);
  });

  it("does nothing when the collector is unreachable", async () => {
    renderPlainDashboard("$96,159");
    handle = startAutoTagging({
      document,
      intervalMs: 1_000_000,
      fetchSnapshot: () => Promise.reject(new Error("collector down")),
    });
    await expect(handle.scan()).resolves.toEqual([]);
    expect(document.querySelector("[data-truth-id]")).toBeNull();
  });

  it("does nothing when no source recorded any values", async () => {
    renderPlainDashboard("$96,159");
    const reported = await tag([
      {
        traceId: "gt_x",
        startedAt: 1,
        events: [{ sourceId: "q", status: "VERIFIED", timestamp: 2 }],
      },
    ]);
    expect(reported).toEqual([]);
  });
});

describe("ambiguity", () => {
  it("refuses to guess which healthy source fed an element", async () => {
    const shared: ServerTrace[] = [
      {
        traceId: "gt_amb",
        route: "/api/x",
        startedAt: 1,
        events: [
          {
            sourceId: "q",
            status: "VERIFIED",
            timestamp: 2,
            produces: ["revenue", "target"],
            values: { revenue: 500, target: 500 },
          },
        ],
      },
    ];

    document.body.innerHTML = `<span>500</span>`;
    const reported = await tag(shared);
    expect(reported[0]?.candidates).toBe(2);

    const result = classifyValue(reported[0]!.id, { nodes: reported, traces: shared });
    expect(result.status).toBe("UNTRACED");
    expect(result.reason).toContain("cannot be determined");
  });

  it("still surfaces an ambiguous match on a failed source, because that is the loud case", async () => {
    const shared: ServerTrace[] = [
      {
        traceId: "gt_amb2",
        startedAt: 1,
        events: [
          {
            sourceId: "revenue-fallback",
            status: "FALLBACK_TRIGGERED",
            timestamp: 2,
            detail: "upstream 503",
            produces: ["revenue", "target"],
            values: { revenue: 500, target: 500 },
          },
        ],
      },
    ];

    document.body.innerHTML = `<span>500</span>`;
    const reported = await tag(shared);
    const result = classifyValue(reported[0]!.id, { nodes: reported, traces: shared });
    expect(result.status).toBe("FALLBACK");
  });
});
