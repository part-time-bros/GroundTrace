/**
 * `pnpm seed` — opens (and therefore creates and seeds) the demo database, then
 * prints what the dashboard's own query returns. Useful for confirming that the
 * healthy number on screen is the number SQLite actually computed.
 */
import { PREVIOUS_PERIOD_SQL, REVENUE_SQL, getDb, type RevenueRow } from "./db.ts";

const db = getDb();
const current = db.prepare(REVENUE_SQL).get() as RevenueRow;
const previous = db.prepare(PREVIOUS_PERIOD_SQL).get() as { revenue: number };
const growth = current.revenue / previous.revenue - 1;

console.log("seeded demo database");
console.log(`  revenue    ${current.revenue}`);
console.log(`  customers  ${current.customers}`);
console.log(`  previous   ${previous.revenue}`);
console.log(`  growth     ${(growth * 100).toFixed(1)}%`);
