/**
 * Box-drawing renderer for provenance trees.
 *
 * Lives in core so the terminal report and the browser overlay draw the exact
 * same tree — the overlay's whole aesthetic (BUILD_SPEC §5) is that it looks
 * like the CLI, and two separate renderers would drift apart within a week.
 */
import { STATUS_LIGHT, type ProvenanceNode } from "./events.js";

export interface RenderTreeOptions {
  /** Prefix each line with its status light. Defaults to true. */
  lights?: boolean;
  /** Include the `detail` line under each labelled node. Defaults to true. */
  details?: boolean;
}

/** Renders a tree as lines of text, root first. */
export function renderTree(
  node: ProvenanceNode,
  options: RenderTreeOptions = {},
): string[] {
  const lights = options.lights ?? true;
  const details = options.details ?? true;
  const lines: string[] = [];

  const walk = (
    current: ProvenanceNode,
    prefix: string,
    isRoot: boolean,
    isLast: boolean,
  ) => {
    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const light = lights ? `${STATUS_LIGHT[current.status]} ` : "";
    lines.push(`${prefix}${connector}${light}${current.label}`);

    const childPrefix = isRoot ? "" : `${prefix}${isLast ? "    " : "│   "}`;

    if (details && current.detail !== undefined && current.detail !== "") {
      const hasChildren = current.children.length > 0;
      lines.push(`${childPrefix}${hasChildren ? "│   " : "    "}${current.detail}`);
    }

    current.children.forEach((child, index) => {
      walk(child, childPrefix, false, index === current.children.length - 1);
    });
  };

  walk(node, "", true, true);
  return lines;
}
