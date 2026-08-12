/**
 * A thin instrumentation wrapper around a prepared-statement database.
 *
 * Typed structurally rather than against better-sqlite3 so the package doesn't
 * take a native dependency it never calls directly — `node:sqlite` and
 * better-sqlite3 both satisfy this shape.
 */
import { withTraceSync, type TraceOptions } from "./context.js";

export interface PreparedStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export interface QueryableDatabase {
  prepare(sql: string): PreparedStatement;
}

export type QueryOptions = Omit<TraceOptions, "kind" | "label"> & {
  /** Overrides the SQL text used as the tree label. */
  label?: string;
};

/** Runs `sql` and records it as one traced source. Rows come back as-is. */
export function instrumentedQuery<T>(
  db: QueryableDatabase,
  sourceId: string,
  sql: string,
  params: unknown[] = [],
  options: QueryOptions = {},
): T {
  return withTraceSync(sourceId, () => db.prepare(sql).all(...params) as T, {
    ...options,
    kind: "db",
    label: options.label ?? squish(sql),
  });
}

/** Single-row variant, for the `SELECT SUM(...)` shape the demo uses. */
export function instrumentedGet<T>(
  db: QueryableDatabase,
  sourceId: string,
  sql: string,
  params: unknown[] = [],
  options: QueryOptions = {},
): T {
  return withTraceSync(sourceId, () => db.prepare(sql).get(...params) as T, {
    ...options,
    kind: "db",
    label: options.label ?? squish(sql),
  });
}

/** Collapses a multi-line SQL string into one readable tree label. */
function squish(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
