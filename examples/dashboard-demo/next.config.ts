import type { NextConfig } from "next";

const config: NextConfig = {
  // better-sqlite3 is a native module; bundling it into the server build breaks
  // the .node binding lookup.
  // `next dev` otherwise writes its own AGENTS.md and CLAUDE.md into this
  // folder, which would sit under — and quietly compete with — the repo's own
  // CLAUDE.md.
  agentRules: false,
  serverExternalPackages: ["better-sqlite3"],
  // Next 16 only trusts `localhost` for dev assets by default, which 404s the
  // client chunks when the demo is opened over an IP — containers, VMs, or a
  // phone on the same network.
  allowedDevOrigins: ["127.0.0.1", "0.0.0.0"],
  async rewrites() {
    return [
      // The SDK and the overlay both default to `/__groundtrace/*` on the app's
      // own origin, so the demo answers there rather than making them configure
      // a bespoke path.
      { source: "/__groundtrace/:path*", destination: "/api/groundtrace/:path*" },
    ];
  },
};

export default config;
