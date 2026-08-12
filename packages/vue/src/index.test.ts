/**
 * Rendered with real Vue. The point of this package is that another reactivity
 * system produces the same `ClientNodeEvent` shape core already understands —
 * asserting that against a mock would prove nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { classifyValue, type ClientNodeEvent, type ServerTrace } from "@groundtrace/core";
import {
  Truth,
  configureClient,
  flushNodes,
  resetClient,
  useTruthValue,
} from "./index.js";

let sent: ClientNodeEvent[];
let host: HTMLElement;
let unmount: (() => void) | undefined;

beforeEach(() => {
  resetClient();
  sent = [];
  configureClient({
    transport: (events) => {
      sent.push(...events);
    },
  });
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  host.remove();
  resetClient();
});

function mount(component: ReturnType<typeof defineComponent>) {
  const app = createApp(component);
  app.mount(host);
  unmount = () => app.unmount();
}

async function flush() {
  await nextTick();
  await flushNodes();
}

const TRACE: ServerTrace[] = [
  {
    traceId: "gt_vue",
    route: "/api/revenue",
    startedAt: 1,
    events: [
      {
        sourceId: "revenue-query",
        status: "VERIFIED",
        timestamp: 2,
        label: "SELECT SUM(total) AS revenue FROM orders",
        produces: ["revenue"],
        values: { revenue: 96_159 },
      },
    ],
  },
];

describe("useTruthValue", () => {
  it("reports the same ClientNodeEvent shape the React SDK produces", async () => {
    mount(
      defineComponent({
        name: "RevenueCard",
        setup() {
          const revenue = ref(96_159);
          useTruthValue(revenue, {
            id: "revenue",
            source: "/api/revenue",
            traceId: "gt_vue",
          });
          return () => h("span", { "data-truth-id": "revenue" }, String(revenue.value));
        },
      }),
    );
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      id: "revenue",
      value: 96_159,
      source: "/api/revenue",
      traceId: "gt_vue",
      component: "RevenueCard",
    });
    expect(host.querySelector("[data-truth-id]")?.textContent).toBe("96159");
  });

  it("classifies through core with no changes to core at all", async () => {
    mount(
      defineComponent({
        setup() {
          useTruthValue(96_159, {
            id: "revenue",
            source: "/api/revenue",
            traceId: "gt_vue",
          });
          return () => h("span", "96,159");
        },
      }),
    );
    await flush();

    const result = classifyValue("revenue", { nodes: sent, traces: TRACE });
    expect(result.status).toBe("VERIFIED");
    expect(result.reason).toContain("matches what it returned");
  });

  it("reports once per value change, not once per render", async () => {
    const revenue = ref(1);
    const unrelated = ref(0);

    mount(
      defineComponent({
        setup() {
          useTruthValue(revenue, { id: "revenue", source: "/api/revenue" });
          return () => h("div", [String(revenue.value), String(unrelated.value)]);
        },
      }),
    );
    await flush();
    expect(sent).toHaveLength(1);

    for (let i = 0; i < 3; i += 1) {
      unrelated.value += 1;
      await flush();
    }
    expect(sent).toHaveLength(1);

    revenue.value = 2;
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.value).toBe(2);
  });

  it("accepts a getter as well as a ref", async () => {
    const state = ref({ revenue: 5 });
    mount(
      defineComponent({
        setup() {
          useTruthValue(() => state.value.revenue, {
            id: "revenue",
            source: "/api/revenue",
          });
          return () => h("span", String(state.value.revenue));
        },
      }),
    );
    await flush();
    expect(sent[0]?.value).toBe(5);
  });

  it("carries a declared transform through", async () => {
    mount(
      defineComponent({
        setup() {
          useTruthValue(18.1, {
            id: "growth",
            source: "/api/revenue",
            transform: "toPercent",
          });
          return () => h("span", "18.1%");
        },
      }),
    );
    await flush();
    expect(sent[0]?.transform).toBe("toPercent");
  });
});

describe("Truth component", () => {
  it("renders the tagged element the overlay clicks on", async () => {
    mount(
      defineComponent({
        setup: () => () =>
          h(
            Truth,
            { id: "revenue", source: "/api/revenue", value: 96_159 },
            () => "$96,159",
          ),
      }),
    );
    await flush();

    const element = host.querySelector("[data-truth-id]");
    expect(element?.tagName).toBe("SPAN");
    expect(element?.getAttribute("data-truth-id")).toBe("revenue");
    expect(element?.textContent).toBe("$96,159");
    expect(sent[0]?.value).toBe(96_159);
  });

  it("can render as another element", async () => {
    mount(
      defineComponent({
        setup: () => () =>
          h(Truth, { id: "total", source: "/api/y", as: "strong", value: 1 }, () => "1"),
      }),
    );
    await flush();
    expect(host.querySelector("[data-truth-id]")?.tagName).toBe("STRONG");
  });
});

describe("client", () => {
  it("reports nothing when disabled", async () => {
    configureClient({ enabled: false });
    mount(
      defineComponent({
        setup() {
          useTruthValue(1, { id: "revenue", source: "/api/y" });
          return () => h("span", "1");
        },
      }),
    );
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("swallows a transport failure rather than surfacing it in the app", async () => {
    configureClient({
      transport: () => {
        throw new Error("collector is down");
      },
    });
    mount(
      defineComponent({
        setup() {
          useTruthValue(1, { id: "revenue", source: "/api/y" });
          return () => h("span", "1");
        },
      }),
    );
    await expect(flush()).resolves.toBeUndefined();
  });
});
