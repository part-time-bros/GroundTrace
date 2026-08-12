import { Dashboard } from "../components/Dashboard";

export const dynamic = "force-dynamic";

export default function Page() {
  // The env var sets where the toggle *starts*; the toggle then flips it live.
  // Reading it here rather than hardcoding `true` in the client is what keeps
  // SIMULATE_API_FAILURE meaningful to anything that loads the page — a
  // screenshot run, a browser-based `groundtrace verify`, or a person.
  const simulateFailure = process.env["SIMULATE_API_FAILURE"] !== "false";
  return <Dashboard initialSimulateFailure={simulateFailure} />;
}
