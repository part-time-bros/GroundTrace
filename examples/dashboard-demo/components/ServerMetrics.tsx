"use client";

/**
 * Client half of the server-rendered page: the data arrives as props from a
 * server component rather than from a fetch, and the trace id comes with it.
 */
import { TraceScope, useTruthValue } from "@groundtrace/react";
import { formatCount, formatCurrency, formatPercent, toPercent } from "../lib/format";

export interface ServerMetricsProps {
  data: { revenue: number; growth: number; customers: number };
  traceId: string;
}

export function ServerMetrics({ data, traceId }: ServerMetricsProps) {
  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Revenue</h1>
          <p className="subtitle">Acme Analytics · rendered on the server</p>
        </div>
      </header>

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

      <p className="hint">
        This page has <span className="strong">no API route and no client fetch</span> —
        the server component queried SQLite directly during render. Click any number; the
        trace works the same.
      </p>

      <footer className="meta">trace {traceId}</footer>
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
  const tracked = useTruthValue(value, {
    id,
    source: "/server",
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
