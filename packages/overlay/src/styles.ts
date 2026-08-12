/**
 * BUILD_SPEC §5's visual direction, in one string.
 *
 * The rule the whole palette follows: the five classification colours are the
 * only colour in the UI. Everything else is greyscale, monospace, and
 * box-drawing characters — a debugger, not a dashboard. If a colour appears
 * here that isn't a status light, it's a bug.
 */
export const STATUS_COLORS = {
  VERIFIED: "#4ade80",
  INDIRECT: "#facc15",
  FALLBACK: "#fb923c",
  SYNTHETIC: "#f87171",
  UNTRACED: "#a1a1aa",
} as const;

/** Injected into the host page: makes tagged values look clickable. */
export const HOST_STYLES = `
[data-truth-id] {
  cursor: help;
  border-bottom: 1px dotted currentColor;
}
[data-truth-id]:hover,
[data-truth-id]:focus-visible {
  outline: 1px dashed currentColor;
  outline-offset: 2px;
}
`;

/** Injected into the overlay's shadow root, where the host app's CSS can't reach it. */
export const PANEL_STYLES = `
:host {
  all: initial;
}
* {
  box-sizing: border-box;
}
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 16px;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
}
.panel {
  pointer-events: auto;
  width: min(680px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #0b0b0c;
  color: #e4e4e7;
  border: 1px solid #27272a;
  border-radius: 6px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  font-size: 12.5px;
  line-height: 1.65;
}
.panel:focus {
  outline: 1px solid #3f3f46;
  outline-offset: -1px;
}
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #27272a;
  background: #0f0f11;
}
.title {
  letter-spacing: 0.14em;
  color: #d4d4d8;
}
.badge {
  color: #71717a;
  border: 1px solid #27272a;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.close {
  appearance: none;
  background: transparent;
  border: 1px solid #27272a;
  border-radius: 3px;
  color: #a1a1aa;
  font: inherit;
  font-size: 11px;
  padding: 1px 7px;
  cursor: pointer;
}
.close:hover,
.close:focus-visible {
  color: #e4e4e7;
  border-color: #52525b;
}
.headline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px 8px;
}
.value {
  color: #fafafa;
  font-size: 14px;
  word-break: break-all;
}
.status {
  white-space: nowrap;
  letter-spacing: 0.08em;
}
.rule {
  border: 0;
  border-top: 1px solid #1c1c1f;
  margin: 0;
}
.tree {
  margin: 0;
  padding: 10px 12px;
  white-space: pre;
  overflow-x: auto;
  font: inherit;
}
.row {
  display: block;
}
.row .prefix {
  color: #3f3f46;
}
.row .detail {
  color: #a1a1aa;
}
.footer {
  padding: 8px 12px 10px;
  color: #a1a1aa;
}
.footer .reason {
  color: #d4d4d8;
}
.meta {
  color: #52525b;
  font-size: 11px;
  margin-top: 4px;
  word-break: break-all;
}
.hint {
  color: #52525b;
  font-size: 11px;
  padding: 0 12px 10px;
}
.error {
  padding: 12px;
  color: #f87171;
}
`;
