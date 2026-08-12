/**
 * Wires the panel to the page.
 *
 * Not a browser extension and not an iframe — just an absolutely-positioned
 * panel in a shadow root (BUILD_SPEC §5). The shadow root matters: this thing
 * gets injected into arbitrary apps, and it must neither inherit their CSS nor
 * leak its own into theirs.
 */
import { COLLECTOR_BASE, type ValueProvenance } from "@groundtrace/core";
import { resolveComponentName } from "./component.js";
import { buildErrorPanel, buildPanel } from "./panel.js";
import { HOST_STYLES, PANEL_STYLES } from "./styles.js";

export const TRUTH_ATTRIBUTE = "data-truth-id";

export interface OverlayOptions {
  /** Collector base URL. Defaults to the page's own origin. */
  endpoint?: string;
  /** Document to attach to. Defaults to the ambient one. */
  document?: Document;
  /** Swappable fetcher, so tests don't need a network. */
  fetchProvenance?: (id: string) => Promise<ValueProvenance>;
  /** Make tagged values keyboard-reachable. Defaults to true. */
  enhanceFocus?: boolean;
}

export interface OverlayHandle {
  open(id: string, trigger?: Element): Promise<void>;
  close(): void;
  destroy(): void;
  readonly openId: string | undefined;
}

const HOST_ID = "groundtrace-overlay-host";

export function mountOverlay(options: OverlayOptions = {}): OverlayHandle {
  const doc = options.document ?? globalThis.document;
  if (doc === undefined) {
    throw new Error("mountOverlay requires a document — it is browser-only.");
  }

  const fetchProvenance = options.fetchProvenance ?? makeFetcher(options.endpoint);

  // --- host + shadow root -------------------------------------------------
  doc.getElementById(HOST_ID)?.remove();
  const host = doc.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  doc.body.append(host);

  const hostStyle = doc.createElement("style");
  hostStyle.setAttribute("data-groundtrace", "host-styles");
  hostStyle.textContent = HOST_STYLES;
  doc.head.append(hostStyle);

  let openId: string | undefined;
  let lastTrigger: Element | undefined;
  let generation = 0;

  function clear(): void {
    shadow.replaceChildren();
  }

  function render(handles: ReturnType<typeof buildPanel>): void {
    const style = doc.createElement("style");
    style.textContent = PANEL_STYLES;
    shadow.replaceChildren(style, handles.root);
    handles.closeButton.addEventListener("click", close);
    handles.panel.focus();
  }

  async function open(id: string, trigger?: Element): Promise<void> {
    const mine = ++generation;
    openId = id;
    lastTrigger = trigger ?? doc.activeElement ?? undefined ?? undefined;

    try {
      const value = await fetchProvenance(id);
      if (mine !== generation) return; // a later click won
      const component = trigger !== undefined ? resolveComponentName(trigger) : undefined;
      render(buildPanel(doc, withComponent(value, component)));
    } catch (error) {
      if (mine !== generation) return;
      const message = error instanceof Error ? error.message : String(error);
      render(buildErrorPanel(doc, `could not load provenance for "${id}": ${message}`));
    }
  }

  function close(): void {
    generation += 1;
    openId = undefined;
    clear();
    if (lastTrigger instanceof HTMLElement && doc.contains(lastTrigger)) {
      lastTrigger.focus();
    }
    lastTrigger = undefined;
  }

  // --- interaction --------------------------------------------------------
  function targetFor(event: Event): Element | undefined {
    const target = event.target;
    if (!(target instanceof Element)) return undefined;
    // Clicks inside the panel arrive retargeted to the host element.
    if (target.id === HOST_ID) return undefined;
    return target.closest(`[${TRUTH_ATTRIBUTE}]`) ?? undefined;
  }

  function onClick(event: Event): void {
    const element = targetFor(event);
    if (element === undefined) return;
    const id = element.getAttribute(TRUTH_ATTRIBUTE);
    if (id === null || id === "") return;
    event.preventDefault();
    void open(id, element);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (openId !== undefined) {
        event.preventDefault();
        close();
      }
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") return;
    const element = targetFor(event);
    if (element === undefined) return;
    const id = element.getAttribute(TRUTH_ATTRIBUTE);
    if (id === null || id === "") return;
    event.preventDefault();
    void open(id, element);
  }

  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKeyDown, true);

  const stopEnhancing = options.enhanceFocus === false ? () => {} : enhanceFocus(doc);

  return {
    open,
    close,
    destroy() {
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      stopEnhancing();
      host.remove();
      hostStyle.remove();
      openId = undefined;
    },
    get openId() {
      return openId;
    },
  };
}

function withComponent(
  value: ValueProvenance,
  component: string | undefined,
): ValueProvenance {
  if (component === undefined) return value;
  // Name the component on the node between the value and its source, which is
  // where the SDK's captured call site otherwise sits alone.
  const [first, ...rest] = value.tree.children;
  if (first === undefined) return value;
  return {
    ...value,
    tree: {
      ...value.tree,
      children: [{ ...first, label: `<${component}> — ${first.label}` }, ...rest],
    },
  };
}

/**
 * Tagged values are usually `<span>`s, which aren't focusable. Give them a tab
 * stop so the overlay is reachable without a mouse.
 */
function enhanceFocus(doc: Document): () => void {
  const apply = () => {
    for (const element of doc.querySelectorAll(`[${TRUTH_ATTRIBUTE}]`)) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.hasAttribute("tabindex")) continue;
      element.tabIndex = 0;
      element.setAttribute("role", "button");
      element.setAttribute("aria-haspopup", "dialog");
    }
  };

  apply();

  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(apply);
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}

function makeFetcher(endpoint: string | undefined) {
  return async (id: string): Promise<ValueProvenance> => {
    const base = endpoint ?? globalThis.location?.origin ?? "http://localhost";
    const url = new URL(`${COLLECTOR_BASE}/value`, base);
    url.searchParams.set("id", id);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`collector responded ${response.status}`);
    }
    return (await response.json()) as ValueProvenance;
  };
}
