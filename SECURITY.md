# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's advisory form](https://github.com/part-time-bros/GroundTrace/security/advisories/new)
rather than opening a public issue. You should get an acknowledgement within a few days.

## What GroundTrace touches

Worth knowing when assessing risk, because a provenance tracer sits close to real data:

- **It records values your app displays and your data sources return.** In `dev` mode those
  are recorded verbatim, in memory, in your own process.
- **The collector has no authentication.** It is a local dev-mode service and binds to
  `127.0.0.1`. Do not expose it.
- **The overlay is dev-mode only** and says so on screen. It injects a panel into the page
  and reads the collector on the same origin.
- **Production mode is off unless explicitly enabled.** When enabled it samples, and redacts
  recorded values to a type, a magnitude bucket, and a digest — so classification still works
  without the underlying figures leaving the process. See `packages/core/src/redact.ts`.

## Things that are not vulnerabilities

- The collector being unauthenticated on localhost in dev mode. That is its design; the
  answer to exposing it publicly is "don't".
- The overlay revealing your own data to you in your own browser.

If you think one of those framings is wrong for a case I haven't thought of, report it — the
framing may well be the bug.
