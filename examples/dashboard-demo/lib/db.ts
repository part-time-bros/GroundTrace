/**
 * The demo's database. Real SQLite, real rows, real query latency — the number
 * on the dashboard has to be a number something actually computed, or the demo
 * proves nothing.
 *
 * Seeded deterministically (fixed-seed LCG, not `Math.random`) so a fresh clone
 * shows the same revenue figure every time and the README can quote it.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = join(process.cwd(), ".data", "demo.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  placed_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS previous_period (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  revenue INTEGER NOT NULL
);
`;

/** The exact query BUILD_SPEC §6 names, unchanged. */
export const REVENUE_SQL =
  "SELECT SUM(total) AS revenue, COUNT(DISTINCT customer_id) AS customers FROM orders";

export const PREVIOUS_PERIOD_SQL = "SELECT revenue FROM previous_period WHERE id = 1";

export interface RevenueRow {
  revenue: number;
  customers: number;
}

/** Deterministic PRNG — a fresh clone must produce the same dashboard. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function seed(db: Database.Database): void {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number };
  if (existing.n > 0) return;

  const random = lcg(20_260_812);
  const insert = db.prepare(
    "INSERT INTO orders (customer_id, total, placed_at) VALUES (?, ?, ?)",
  );

  const insertMany = db.transaction(() => {
    // Sized so the real total lands nowhere near the hardcoded fallback below —
    // if the two numbers looked alike, toggling the demo would prove nothing.
    for (let i = 0; i < 118; i += 1) {
      const customerId = 1 + Math.floor(random() * 29);
      const total = 200 + Math.floor(random() * 1_200);
      const day = 1 + Math.floor(random() * 28);
      insert.run(customerId, total, `2026-07-${String(day).padStart(2, "0")}`);
    }
    db.prepare("INSERT OR REPLACE INTO previous_period (id, revenue) VALUES (1, ?)").run(
      81_400,
    );
  });

  insertMany();
}

/**
 * One connection per process, cached on `globalThis` — Next's dev server
 * re-evaluates modules on hot reload, and a module-level `const` would leak a
 * new SQLite handle on every edit.
 */
const DB_KEY = Symbol.for("groundtrace.demo.db");
type GlobalWithDb = typeof globalThis & { [DB_KEY]?: Database.Database };

export function getDb(): Database.Database {
  const scope = globalThis as GlobalWithDb;
  if (scope[DB_KEY] !== undefined) return scope[DB_KEY];

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  seed(db);

  scope[DB_KEY] = db;
  return db;
}
