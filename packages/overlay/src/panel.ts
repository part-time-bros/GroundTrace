/**
 * Builds the overlay panel's DOM from a classified value.
 *
 * Kept separate from the mounting/event plumbing so it can be rendered and
 * asserted on directly in tests.
 */
import {
  STATUS_LIGHT,
  flattenTree,
  formatValue,
  type ProvenanceReport,
  type ProvenanceStatus,
  type ValueProvenance,
} from "@groundtrace/core";
import { PANEL_STYLES, STATUS_COLORS } from "./styles.js";

export interface PanelHandles {
  root: HTMLElement;
  panel: HTMLElement;
  closeButton: HTMLButtonElement;
  /** Present on the single-value panel: opens the all-values summary. */
  allButton?: HTMLButtonElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function statusColor(status: ProvenanceStatus): string {
  return STATUS_COLORS[status];
}

export function buildStyleElement(doc: Document): HTMLStyleElement {
  const style = doc.createElement("style");
  style.textContent = PANEL_STYLES;
  return style;
}

export function buildPanel(doc: Document, value: ValueProvenance): PanelHandles {
  const backdrop = el(doc, "div", "backdrop");

  const panel = el(doc, "section", "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", `GroundTrace provenance for ${value.id}`);
  panel.tabIndex = -1;

  // --- title bar ----------------------------------------------------------
  const titlebar = el(doc, "header", "titlebar");
  titlebar.append(el(doc, "span", "title", "GROUNDTRACE"));

  const titleRight = el(doc, "span");
  // Non-goals in CLAUDE.md are explicit that this is a dev-mode tool. Say so
  // on screen rather than in a doc nobody reads at 2am.
  titleRight.append(el(doc, "span", "badge", "DEV MODE — not for production"));
  const closeButton = el(doc, "button", "close", "esc");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close GroundTrace overlay");
  titleRight.append(" ", closeButton);
  titlebar.append(titleRight);
  panel.append(titlebar);

  // --- headline -----------------------------------------------------------
  const headline = el(doc, "div", "headline");
  headline.append(el(doc, "span", "value", `${value.id} = ${formatValue(value.value)}`));

  const status = el(
    doc,
    "span",
    "status",
    `${STATUS_LIGHT[value.status]} ${value.status}`,
  );
  status.style.color = statusColor(value.status);
  headline.append(status);
  panel.append(headline, el(doc, "hr", "rule"));

  // --- tree ---------------------------------------------------------------
  const tree = el(doc, "pre", "tree");
  // The root node's detail is the verdict's reason, which the footer already
  // states in full. Printing it inside the tree as well makes it the widest
  // line in the panel and says nothing new.
  const rows = flattenTree(value.tree).filter(
    (row) => !(row.isDetail && row.label === value.reason),
  );
  for (const row of rows) {
    const line = el(doc, "span", "row");
    line.append(el(doc, "span", "prefix", row.prefix));

    if (row.isDetail) {
      line.append(el(doc, "span", "detail", row.label));
    } else {
      const light = el(doc, "span", "light", `${STATUS_LIGHT[row.status]} `);
      const label = el(doc, "span", "label", row.label);
      label.style.color = statusColor(row.status);
      line.append(light, label);
    }

    line.append(doc.createTextNode("\n"));
    tree.append(line);
  }
  panel.append(tree, el(doc, "hr", "rule"));

  // --- footer -------------------------------------------------------------
  const footer = el(doc, "div", "footer");
  const reason = el(doc, "div", "reason", value.reason);
  reason.style.color = statusColor(value.status);
  footer.append(reason);

  const meta = el(
    doc,
    "div",
    "meta",
    [
      `source ${value.source}`,
      value.traceId !== undefined ? `trace ${value.traceId}` : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join("  ·  "),
  );
  footer.append(meta);
  panel.append(footer);

  const hint = el(doc, "div", "hint");
  hint.append(doc.createTextNode("click any underlined value · "));
  const allButton = el(doc, "button", "linkish", "show all values");
  allButton.type = "button";
  hint.append(allButton, doc.createTextNode(" · esc to close"));
  panel.append(hint);

  backdrop.append(panel);
  return { root: backdrop, panel, closeButton, allButton };
}

/**
 * Every tracked value on the page at once.
 *
 * Clicking one value answers "where did *this* come from"; this answers "is
 * anything on this page not real", which is the question you actually have
 * before you know which number to suspect.
 */
export function buildSummaryPanel(doc: Document, report: ProvenanceReport): PanelHandles {
  const backdrop = el(doc, "div", "backdrop");
  const panel = el(doc, "section", "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "GroundTrace — all tracked values");
  panel.tabIndex = -1;

  const titlebar = el(doc, "header", "titlebar");
  titlebar.append(el(doc, "span", "title", "GROUNDTRACE"));
  const titleRight = el(doc, "span");
  titleRight.append(el(doc, "span", "badge", "DEV MODE — not for production"));
  const closeButton = el(doc, "button", "close", "esc");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close GroundTrace overlay");
  titleRight.append(" ", closeButton);
  titlebar.append(titleRight);
  panel.append(titlebar);

  const headline = el(doc, "div", "headline");
  headline.append(
    el(
      doc,
      "span",
      "value",
      `${report.tracked} tracked value${report.tracked === 1 ? "" : "s"}`,
    ),
  );

  const confidence = el(
    doc,
    "span",
    "status",
    report.confidence === null
      ? "— nothing tracked"
      : `${Math.round(report.confidence * 100)}% confidence`,
  );
  confidence.style.color =
    report.confidence === null
      ? STATUS_COLORS.UNTRACED
      : report.confidence === 1
        ? STATUS_COLORS.VERIFIED
        : report.confidence >= 0.5
          ? STATUS_COLORS.INDIRECT
          : STATUS_COLORS.FALLBACK;
  headline.append(confidence);
  panel.append(headline, el(doc, "hr", "rule"));

  const list = el(doc, "pre", "tree");
  if (report.values.length === 0) {
    list.append(el(doc, "span", "detail", "Nothing has been reported yet.\n"));
  }
  for (const value of report.values) {
    const row = el(doc, "span", "row");
    const label = el(
      doc,
      "span",
      "label",
      `${STATUS_LIGHT[value.status]} ${value.id} = ${formatValue(value.value)}`,
    );
    label.style.color = statusColor(value.status);
    row.append(label, doc.createTextNode("\n"));

    const why = el(doc, "span", "row");
    why.append(
      el(doc, "span", "prefix", "    "),
      el(doc, "span", "detail", value.reason),
    );
    why.append(doc.createTextNode("\n"));

    list.append(row, why);
  }
  panel.append(list, el(doc, "hr", "rule"));
  panel.append(el(doc, "div", "hint", "click any underlined value · esc to close"));

  backdrop.append(panel);
  return { root: backdrop, panel, closeButton };
}

export function buildErrorPanel(doc: Document, message: string): PanelHandles {
  const backdrop = el(doc, "div", "backdrop");
  const panel = el(doc, "section", "panel");
  panel.setAttribute("role", "dialog");
  panel.tabIndex = -1;

  const titlebar = el(doc, "header", "titlebar");
  titlebar.append(el(doc, "span", "title", "GROUNDTRACE"));
  const closeButton = el(doc, "button", "close", "esc");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close GroundTrace overlay");
  titlebar.append(closeButton);

  panel.append(titlebar, el(doc, "div", "error", message));
  backdrop.append(panel);
  return { root: backdrop, panel, closeButton };
}
