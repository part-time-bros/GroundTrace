/**
 * Box-drawing renderer for provenance trees.
 *
 * Lives in core so the terminal report and the browser overlay draw the exact
 * same tree — the overlay's whole aesthetic (BUILD_SPEC §5) is that it looks
 * like the CLI, and two separate renderers would drift apart within a week.
 *
 * `flattenTree` is the shared primitive: it does the connector arithmetic once
 * and hands back structured rows, so the terminal can join them into strings
 * and the overlay can colour each row by its own status.
 */
import { STATUS_LIGHT, type ProvenanceNode, type ProvenanceStatus } from "./events.js";

export interface TreeRow {
  /** Box-drawing prefix: indentation plus this row's connector. */
  prefix: string;
  label: string;
  status: ProvenanceStatus;
  depth: number;
  /** True for the wrapped `detail` line that follows a labelled row. */
  isDetail: boolean;
}

export function flattenTree(node: ProvenanceNode): TreeRow[] {
  const rows: TreeRow[] = [];

  const walk = (
    current: ProvenanceNode,
    prefix: string,
    isRoot: boolean,
    isLast: boolean,
    depth: number,
  ) => {
    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    rows.push({
      prefix: `${prefix}${connector}`,
      label: current.label,
      status: current.status,
      depth,
      isDetail: false,
    });

    const childPrefix = isRoot ? "" : `${prefix}${isLast ? "    " : "│   "}`;

    if (current.detail !== undefined && current.detail !== "") {
      rows.push({
        prefix: `${childPrefix}${current.children.length > 0 ? "│   " : "    "}`,
        label: current.detail,
        status: current.status,
        depth: depth + 1,
        isDetail: true,
      });
    }

    current.children.forEach((child, index) => {
      walk(child, childPrefix, false, index === current.children.length - 1, depth + 1);
    });
  };

  walk(node, "", true, true, 0);
  return rows;
}

export interface RenderTreeOptions {
  /** Prefix each labelled row with its status light. Defaults to true. */
  lights?: boolean;
  /** Include the `detail` row under each labelled node. Defaults to true. */
  details?: boolean;
}

/** Renders a tree as lines of text, root first. */
export function renderTree(
  node: ProvenanceNode,
  options: RenderTreeOptions = {},
): string[] {
  const lights = options.lights ?? true;
  const details = options.details ?? true;

  return flattenTree(node)
    .filter((row) => details || !row.isDetail)
    .map((row) => {
      const light = lights && !row.isDetail ? `${STATUS_LIGHT[row.status]} ` : "";
      return `${row.prefix}${light}${row.label}`;
    });
}
