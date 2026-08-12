import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyValue,
  type EventSnapshot,
  type ValueProvenance,
} from "@groundtrace/core";
import { mountOverlay, type OverlayHandle } from "./mount.js";
import { STATUS_COLORS } from "./styles.js";

// Provenance is produced by the real classifier from realistic events, so the
// overlay is asserted against what the collector actually serves.
const VERIFIED_SNAPSHOT: EventSnapshot = {
  nodes: [
    {
      id: "revenue",
      value: 91_400,
      source: "/api/revenue",
      traceId: "gt_1",
      callSite: "DashboardCard (DashboardCard.tsx:42)",
      capturedAt: 1_000,
    },
  ],
  traces: [
    {
      traceId: "gt_1",
      route: "/api/revenue",
      startedAt: 900,
      events: [
        {
          sourceId: "revenue-query",
          status: "VERIFIED",
          timestamp: 940,
          kind: "db",
          label: "SELECT SUM(total) AS revenue FROM orders",
          produces: ["revenue"],
          values: { revenue: 91_400 },
        },
      ],
    },
  ],
};

const FALLBACK_SNAPSHOT: EventSnapshot = {
  nodes: [{ ...VERIFIED_SNAPSHOT.nodes[0]!, value: 184_293 }],
  traces: [
    {
      traceId: "gt_1",
      route: "/api/revenue",
      startedAt: 900,
      events: [
        {
          sourceId: "revenue-query",
          status: "FALLBACK_TRIGGERED",
          timestamp: 940,
          kind: "db",
          label: "SELECT SUM(total) AS revenue FROM orders",
          produces: ["revenue"],
          detail: "SIMULATE_API_FAILURE is on",
        },
        {
          sourceId: "revenue-fallback",
          status: "FALLBACK_TRIGGERED",
          timestamp: 941,
          kind: "compute",
          label: "catch block returned a hardcoded value",
          produces: ["revenue"],
          values: { revenue: 184_293 },
        },
      ],
    },
  ],
};

let overlay: OverlayHandle | undefined;

function mount(snapshot: EventSnapshot, extra: { fail?: boolean } = {}) {
  overlay = mountOverlay({
    document,
    fetchProvenance: async (id) => {
      if (extra.fail === true) throw new Error("collector responded 500");
      return classifyValue(id, snapshot);
    },
  });
  return overlay;
}

function panel(): ShadowRoot {
  const host = document.getElementById("groundtrace-overlay-host");
  if (host?.shadowRoot == null) throw new Error("overlay host is not mounted");
  return host.shadowRoot;
}

function panelText(): string {
  return panel().textContent ?? "";
}

function tagged(id: string, label: string): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("data-truth-id", id);
  span.textContent = label;
  document.body.append(span);
  return span;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

afterEach(() => {
  overlay?.destroy();
  overlay = undefined;
});

describe("clicking a tracked value", () => {
  it("shows a green-toned tree ending in the real source for a VERIFIED value", async () => {
    mount(VERIFIED_SNAPSHOT);
    const element = tagged("revenue", "$91,400");

    element.click();
    await Promise.resolve();
    await Promise.resolve();

    const text = panelText();
    expect(text).toContain("revenue = 91400");
    expect(text).toContain("VERIFIED");
    expect(text).toContain("🟢");
    expect(text).toContain("SELECT SUM(total) AS revenue FROM orders");

    const status = panel().querySelector(".status") as HTMLElement;
    expect(status.style.color).toBe(toRgb(STATUS_COLORS.VERIFIED));
  });

  it("shows an orange-toned tree ending in the catch block for a FALLBACK value", async () => {
    mount(FALLBACK_SNAPSHOT);
    tagged("revenue", "$184,293").click();
    await Promise.resolve();
    await Promise.resolve();

    const text = panelText();
    expect(text).toContain("FALLBACK");
    expect(text).toContain("🟠");
    expect(text).toContain("catch block returned a hardcoded value");
    expect(text).toContain("SIMULATE_API_FAILURE is on");
    // The punchline the pitch asks for, verbatim.
    expect(text).toContain("not backed by live data");

    const status = panel().querySelector(".status") as HTMLElement;
    expect(status.style.color).toBe(toRgb(STATUS_COLORS.FALLBACK));
  });

  it("says it is a dev-mode tool, on screen", async () => {
    mount(VERIFIED_SNAPSHOT);
    tagged("revenue", "$91,400").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(panelText()).toContain("DEV MODE — not for production");
  });

  it("ignores clicks on untagged elements", async () => {
    mount(VERIFIED_SNAPSHOT);
    const plain = document.createElement("div");
    document.body.append(plain);
    plain.click();
    await Promise.resolve();
    expect(overlay?.openId).toBeUndefined();
    expect(panelText()).toBe("");
  });

  it("opens for a click on a child of the tagged element", async () => {
    mount(VERIFIED_SNAPSHOT);
    const element = tagged("revenue", "");
    const inner = document.createElement("b");
    inner.textContent = "$91,400";
    element.append(inner);

    inner.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(panelText()).toContain("revenue = 91400");
  });

  it("reports a collector failure instead of rendering an empty panel", async () => {
    mount(VERIFIED_SNAPSHOT, { fail: true });
    tagged("revenue", "$91,400").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(panelText()).toContain("could not load provenance");
    expect(panelText()).toContain("collector responded 500");
  });
});

describe("keyboard", () => {
  it("gives tagged values a tab stop", async () => {
    const element = tagged("revenue", "$91,400");
    mount(VERIFIED_SNAPSHOT);
    expect(element.tabIndex).toBe(0);
    expect(element.getAttribute("role")).toBe("button");

    // Values that appear later are enhanced by the observer, which — like every
    // MutationObserver — runs on a microtask rather than synchronously.
    const later = tagged("customers", "128");
    expect(later.tabIndex).toBe(-1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(later.tabIndex).toBe(0);
  });

  it("opens on Enter", async () => {
    mount(VERIFIED_SNAPSHOT);
    const element = tagged("revenue", "$91,400");
    element.focus();
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(panelText()).toContain("revenue = 91400");
  });

  it("closes on Escape and returns focus to the value that opened it", async () => {
    mount(VERIFIED_SNAPSHOT);
    const element = tagged("revenue", "$91,400");
    element.focus();
    element.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlay?.openId).toBe("revenue");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(overlay?.openId).toBeUndefined();
    expect(panelText()).toBe("");
    expect(document.activeElement).toBe(element);
  });

  it("moves focus into the panel when it opens", async () => {
    mount(VERIFIED_SNAPSHOT);
    tagged("revenue", "$91,400").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(panel().activeElement).toBe(panel().querySelector(".panel"));
  });

  it("closes from the close button", async () => {
    mount(VERIFIED_SNAPSHOT);
    tagged("revenue", "$91,400").click();
    await Promise.resolve();
    await Promise.resolve();
    (panel().querySelector(".close") as HTMLButtonElement).click();
    expect(overlay?.openId).toBeUndefined();
  });
});

describe("mounting", () => {
  it("isolates its own styles inside a shadow root", () => {
    mount(VERIFIED_SNAPSHOT);
    const host = document.getElementById("groundtrace-overlay-host");
    expect(host?.shadowRoot).toBeTruthy();
    expect(document.head.querySelector("[data-groundtrace]")).toBeTruthy();
  });

  it("picks up values added to the page after mounting", async () => {
    mount(VERIFIED_SNAPSHOT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const late = tagged("revenue", "$91,400");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.tabIndex).toBe(0);
  });

  it("cleans up completely on destroy", () => {
    const handle = mount(VERIFIED_SNAPSHOT);
    handle.destroy();
    overlay = undefined;
    expect(document.getElementById("groundtrace-overlay-host")).toBeNull();
    expect(document.head.querySelector("[data-groundtrace]")).toBeNull();
  });

  it("does not stack two hosts when mounted twice", () => {
    mount(VERIFIED_SNAPSHOT);
    mount(VERIFIED_SNAPSHOT);
    expect(document.querySelectorAll("#groundtrace-overlay-host")).toHaveLength(1);
  });

  it("can be opened programmatically", async () => {
    const handle = mount(VERIFIED_SNAPSHOT);
    await handle.open("revenue");
    expect(panelText()).toContain("revenue = 91400");
  });
});

describe("the last click wins", () => {
  it("does not let a slow first request overwrite a fast second one", async () => {
    let resolveFirst: ((value: ValueProvenance) => void) | undefined;
    let call = 0;

    overlay = mountOverlay({
      document,
      fetchProvenance: (id) => {
        call += 1;
        if (call === 1) {
          return new Promise<ValueProvenance>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(classifyValue(id, FALLBACK_SNAPSHOT));
      },
    });

    const slow = overlay.open("revenue");
    const fast = overlay.open("revenue");
    await fast;
    expect(panelText()).toContain("FALLBACK");

    resolveFirst?.(classifyValue("revenue", VERIFIED_SNAPSHOT));
    await slow;
    expect(panelText()).toContain("FALLBACK");
  });
});

function toRgb(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
