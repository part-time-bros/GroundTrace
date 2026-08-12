"use client";

/**
 * The dashboard. Three numbers, one API call, no error state — because as far
 * as this component knows, the API always succeeds.
 *
 * The only GroundTrace-specific lines are `useTruthValue` around each displayed
 * value and the matching `data-truth-id` on the element showing it. Everything
 * else is what you would have written anyway.
 */
import { useState } from "react";
import { TraceScope, useTracedQuery, useTruthValue } from "@groundtrace/react";
import type { RevenuePayload } from "../app/api/revenue/route";
import { formatCount, formatCurrency, formatPercent, toPercent } from "../lib/format";

export function Dashboard({
  initialSimulateFailure = true,
}: {
  /** Where the toggle starts — set from `SIMULATE_API_FAILURE` on the server. */
  initialSimulateFailure?: boolean;
}) {
  // Flips live from here, so a screen recording never has to restart anything.
  const [simulateFailure, setSimulateFailure] = useState(initialSimulateFailure);
  const { data, traceId, loading, error } = useTracedQuery<RevenuePayload>(
    `/api/revenue?fail=${simulateFailure ? "1" : "0"}`,
  );

  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Revenue</h1>
          <p className="subtitle">Acme Analytics · July 2026</p>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={simulateFailure}
            onChange={(event) => setSimulateFailure(event.target.checked)}
          />
          Simulate API failure
        </label>
      </header>

      {error !== undefined ? (
        <p className="loading">Could not reach /api/revenue: {error.message}</p>
      ) : loading || data === undefined ? (
        <p className="loading">Loading…</p>
      ) : (
        <TraceScope traceId={traceId}>
          <div className="cards">
            <Metric
              id="revenue"
              label="Total revenue"
              value={data.revenue}
              format={formatCurrency}
            />
            <Metric
              id="growth"
              label="Growth vs. last period"
              value={toPercent(data.growth)}
              format={formatPercent}
              transform="toPercent"
            />
            <Metric
              id="customers"
              label="Customers"
              value={data.customers}
              format={formatCount}
            />
          </div>
        </TraceScope>
      )}

      <p className="hint">
        <span className="strong">Click any number above.</span> GroundTrace traces it back
        through component → state → API → database and tells you whether what you are
        looking at is real. Toggle <code>Simulate API failure</code> and click again.
      </p>

      <footer className="meta">
        trace {traceId ?? "—"} · {data?.asOf ?? "—"}
      </footer>
    </main>
  );
}

interface MetricProps {
  id: string;
  label: string;
  value: number | undefined;
  format: (value: number | undefined) => string;
  transform?: string;
}

function Metric({ id, label, value, format, transform }: MetricProps) {
  // Tracks the raw value; the DOM shows the formatted one. Declaring the
  // transform for `growth` is what makes it 🟡 INDIRECT instead of 🟢 VERIFIED.
  const tracked = useTruthValue(value, {
    id,
    source: "/api/revenue",
    ...(transform !== undefined ? { transform } : {}),
  });

  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="figure" data-truth-id={id}>
        {format(tracked)}
      </div>
      <div className="note">click to trace</div>
    </div>
  );
}
