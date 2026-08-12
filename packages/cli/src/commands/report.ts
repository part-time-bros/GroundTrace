/**
 * `groundtrace report` — prints the last `verify` run. Re-running nothing is
 * the feature: this is what a Stop hook or a CI summary reads.
 */
import { STATUS_LIGHT, renderTree, type ValueProvenance } from "@groundtrace/core";
import { loadVerifyResult, reportPath } from "../report-store.js";
import { box, paint } from "../ui.js";
import { formatVerify } from "./verify.js";

export interface ReportOptions {
  cwd: string;
  /** Print the full provenance tree for one tracked value. */
  id?: string;
  json?: boolean;
}

export function runReport(options: ReportOptions): number {
  const result = loadVerifyResult(options.cwd);

  if (result === undefined) {
    console.error(
      `no saved report at ${reportPath(options.cwd)} — run ${paint("groundtrace verify", "bold")} first`,
    );
    return 1;
  }

  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (options.id !== undefined) {
    return printValue(result.provenance.report?.values ?? [], options.id);
  }

  console.log(formatVerify(result));
  console.log("");
  console.log(paint(`from ${new Date(result.generatedAt).toISOString()}`, "gray"));
  return 0;
}

function printValue(values: ValueProvenance[], id: string): number {
  const value = values.find((candidate) => candidate.id === id);

  if (value === undefined) {
    const known = values.map((candidate) => candidate.id);
    console.error(
      known.length === 0
        ? "no tracked values in the last report"
        : `no tracked value "${id}" in the last report — known ids: ${known.join(", ")}`,
    );
    return 1;
  }

  console.log(
    box(`${STATUS_LIGHT[value.status]} ${value.id} — ${value.status}`, [
      ...renderTree(value.tree),
      "",
      value.reason,
    ]),
  );
  return 0;
}
