/**
 * IIFE entry point. `groundtrace run` injects the bundle built from this file
 * into the target app's HTML with a single <script> tag, so it has to
 * self-configure from the tag's own data attributes and mount itself.
 *
 *   <script src="/__groundtrace/overlay.js" data-endpoint="http://127.0.0.1:7777"></script>
 */
import { mountOverlay, type OverlayHandle } from "./mount.js";

declare global {
  interface Window {
    __groundtrace__?: OverlayHandle;
  }
}

function readEndpoint(): string | undefined {
  const current = document.currentScript;
  const fromTag = current?.getAttribute("data-endpoint") ?? undefined;
  if (fromTag !== undefined && fromTag !== "") return fromTag;

  const tagged = document.querySelector("script[data-groundtrace-endpoint]");
  const fromQuery = tagged?.getAttribute("data-groundtrace-endpoint") ?? undefined;
  return fromQuery !== undefined && fromQuery !== "" ? fromQuery : undefined;
}

function start(): void {
  if (window.__groundtrace__ !== undefined) return;
  const endpoint = readEndpoint();
  window.__groundtrace__ = mountOverlay(endpoint !== undefined ? { endpoint } : {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
