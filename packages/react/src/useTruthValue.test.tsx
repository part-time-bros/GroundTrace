import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { ClientNodeEvent } from "@groundtrace/core";
import { configureClient, flushNodes, resetClient } from "./client.js";
import { Truth } from "./Truth.js";
import { TraceScope } from "./trace-scope.js";
import { stableKey, useTruthValue } from "./useTruthValue.js";

let sent: ClientNodeEvent[];

beforeEach(() => {
  resetClient();
  sent = [];
  configureClient({
    transport: (events) => {
      sent.push(...events);
    },
  });
});

afterEach(() => {
  cleanup();
  resetClient();
});

/** Batching is a microtask, so tests flush before asserting. */
async function flush() {
  await act(async () => {
    await flushNodes();
  });
}

function Revenue({
  value,
  source = "/api/revenue",
}: {
  value: unknown;
  source?: string;
}) {
  const tracked = useTruthValue(value, { id: "revenue", source });
  return <span data-truth-id="revenue">{String(tracked)}</span>;
}

describe("Truth", () => {
  it("renders the tagged span the overlay clicks on", async () => {
    render(
      <Truth id="x" source="/api/y">
        42
      </Truth>,
    );
    const element = screen.getByText("42");
    expect(element.tagName).toBe("SPAN");
    expect(element.getAttribute("data-truth-id")).toBe("x");
    await flush();
  });

  it("can render as another element and keep the tag", async () => {
    render(
      <Truth id="total" source="/api/y" as="strong" className="big">
        99
      </Truth>,
    );
    const element = screen.getByText("99");
    expect(element.tagName).toBe("STRONG");
    expect(element.getAttribute("data-truth-id")).toBe("total");
    expect(element.className).toBe("big");
    await flush();
  });

  it("reports the raw value, not the formatted children, when given one", async () => {
    render(
      <Truth id="revenue" source="/api/revenue" value={184293}>
        $184,293
      </Truth>,
    );
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.value).toBe(184293);
  });
});

describe("useTruthValue", () => {
  it("returns the value untouched", () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useTruthValue({ a: 1 }, { id: "obj", source: "/api/y" }));
      return null;
    }
    render(<Probe />);
    expect(seen[0]).toEqual({ a: 1 });
  });

  it("reports the value, source, and call site", async () => {
    render(<Revenue value={91400} />);
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      id: "revenue",
      value: 91400,
      source: "/api/revenue",
    });
    expect(sent[0]?.capturedAt).toBeGreaterThan(0);
    expect(typeof sent[0]?.callSite).toBe("string");
  });

  it("reports once per value change, not once per render", async () => {
    function Harness() {
      const [value, setValue] = useState(1);
      const [unrelated, setUnrelated] = useState(0);
      return (
        <div>
          <Revenue value={value} />
          <button onClick={() => setValue((current) => current + 1)}>bump value</button>
          <button onClick={() => setUnrelated((current) => current + 1)}>
            re-render {unrelated}
          </button>
        </div>
      );
    }

    render(<Harness />);
    await flush();
    expect(sent).toHaveLength(1);

    // Three renders that do not change the tracked value.
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        screen.getByText(/re-render/).click();
      });
      await flush();
    }
    expect(sent).toHaveLength(1);

    act(() => {
      screen.getByText("bump value").click();
    });
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.value).toBe(2);
  });

  it("treats a structurally identical object as unchanged", async () => {
    function Harness() {
      const [nonce, setNonce] = useState(0);
      // A fresh object identity every render — the naive dep array's failure case.
      const value = { revenue: 91400, growth: 0.12 };
      return (
        <div>
          <Revenue value={value} />
          <button onClick={() => setNonce(nonce + 1)}>re-render</button>
        </div>
      );
    }

    render(<Harness />);
    await flush();
    expect(sent).toHaveLength(1);

    act(() => {
      screen.getByText("re-render").click();
    });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it("reports again when the source changes even if the value doesn't", async () => {
    const { rerender } = render(<Revenue value={5} source="/api/a" />);
    await flush();
    rerender(<Revenue value={5} source="/api/b" />);
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.source).toBe("/api/b");
  });

  it("picks up the trace id from the surrounding scope", async () => {
    render(
      <TraceScope traceId="gt_scope-1">
        <Revenue value={7} />
      </TraceScope>,
    );
    await flush();
    expect(sent[0]?.traceId).toBe("gt_scope-1");
  });

  it("lets an explicit trace id win over the scope", async () => {
    function Explicit() {
      useTruthValue(7, { id: "revenue", source: "/api/revenue", traceId: "gt_explicit" });
      return null;
    }
    render(
      <TraceScope traceId="gt_scope-1">
        <Explicit />
      </TraceScope>,
    );
    await flush();
    expect(sent[0]?.traceId).toBe("gt_explicit");
  });

  it("carries a declared transform through, which is what makes a value INDIRECT", async () => {
    function Growth() {
      useTruthValue(0.248, {
        id: "growth",
        source: "/api/revenue",
        transform: "toPercent",
      });
      return null;
    }
    render(<Growth />);
    await flush();
    expect(sent[0]?.transform).toBe("toPercent");
  });

  it("falls back to a generated id when none is given", async () => {
    function Anonymous() {
      useTruthValue(1, { source: "/api/y" });
      return null;
    }
    render(<Anonymous />);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.id).toBeTruthy();
  });
});

describe("batching", () => {
  it("sends one batch for a page full of tracked values", async () => {
    const batches: ClientNodeEvent[][] = [];
    configureClient({
      transport: (events) => {
        batches.push(events);
      },
    });

    function Page() {
      useTruthValue(1, { id: "a", source: "/api/y" });
      useTruthValue(2, { id: "b", source: "/api/y" });
      useTruthValue(3, { id: "c", source: "/api/y" });
      return null;
    }

    render(<Page />);
    await flush();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("keeps only the latest event per id inside a batch", async () => {
    const { rerender } = render(<Revenue value={1} />);
    rerender(<Revenue value={2} />);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.value).toBe(2);
  });

  it("swallows a transport failure instead of surfacing it in the app", async () => {
    configureClient({
      transport: () => {
        throw new Error("collector is down");
      },
    });
    render(<Revenue value={1} />);
    await expect(flush()).resolves.toBeUndefined();
  });

  it("reports nothing when disabled", async () => {
    configureClient({ enabled: false });
    render(<Revenue value={1} />);
    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe("stableKey", () => {
  it("is stable across key order", () => {
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }));
  });

  it("separates types that stringify the same", () => {
    expect(stableKey(1)).not.toBe(stableKey("1"));
    expect(stableKey(null)).not.toBe(stableKey(undefined));
  });

  it("does not throw on a circular value", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => stableKey(circular)).not.toThrow();
  });
});

describe("default transport", () => {
  it("POSTs a batch to the collector on the app's own origin", async () => {
    resetClient();
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return Promise.resolve(new Response("{}"));
    });

    render(<Revenue value={1} />);
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/__groundtrace/nodes");
    expect(calls[0]?.body).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
