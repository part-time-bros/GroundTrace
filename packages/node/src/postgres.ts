/**
 * Postgres adapter (V2_SPEC §13).
 *
 * The provenance approach never cared which database sits behind the wrapper —
 * V1 only shipped a synchronous one because better-sqlite3 is synchronous.
 * These are the async twins, typed against the `pg` client shape so `pg`,
 * connection pools, and anything else exposing `query(text, values)` all
 * satisfy them without `pg` becoming a dependency.
 */
import { withTrace, type TraceOptions } from "./context.js";

export interface QueryResult<T> {
  rows: T[];
  rowCount?: number | null;
}

export interface AsyncQueryable {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export type AsyncQueryOptions = Omit<TraceOptions, "kind"> & {
  /** Overrides the SQL text used as the tree label. */
  label?: string;
};

/** Runs `sql` and records it as one traced source. Returns every row. */
export async function instrumentedQueryAsync<T = Record<string, unknown>>(
  db: AsyncQueryable,
  sourceId: string,
  sql: string,
  params: unknown[] = [],
  options: AsyncQueryOptions = {},
): Promise<T[]> {
  return withTrace(
    sourceId,
    async () => {
      const result = await db.query<T>(sql, params);
      return result.rows;
    },
    { ...options, kind: "db", label: options.label ?? squish(sql) },
  );
}

/**
 * Single-row variant, for the `SELECT SUM(...)` shape a dashboard actually uses.
 *
 * A query that matches no rows returns `undefined` rather than throwing: an
 * empty result is a real answer, not a failure, and recording it as
 * FALLBACK_TRIGGERED would report a working query as broken.
 */
export async function instrumentedGetAsync<T = Record<string, unknown>>(
  db: AsyncQueryable,
  sourceId: string,
  sql: string,
  params: unknown[] = [],
  options: AsyncQueryOptions = {},
): Promise<T | undefined> {
  return withTrace(
    sourceId,
    async () => {
      const result = await db.query<T>(sql, params);
      return result.rows[0];
    },
    { ...options, kind: "db", label: options.label ?? squish(sql) },
  );
}

/** Collapses a multi-line SQL string into one readable tree label. */
function squish(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
