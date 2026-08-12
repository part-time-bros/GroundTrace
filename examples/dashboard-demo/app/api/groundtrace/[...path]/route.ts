/**
 * The collector, hosted inside the demo's own Next server.
 *
 * BUILD_SPEC §6 requires the demo to work from `pnpm install && pnpm dev` with
 * no manual setup, so it can't depend on `groundtrace run` being up. Both hosts
 * mount the same `handleCollectorRequest` from core, so there is one set of
 * semantics regardless of which one is serving.
 *
 * `next.config.ts` rewrites `/__groundtrace/*` here, which is the path the SDK
 * and the overlay use by default.
 */
import { handleCollectorRequest, sharedStore } from "@groundtrace/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const url = new URL(request.url);

  let body: unknown;
  if (request.method === "POST") {
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
  }

  const result = handleCollectorRequest(sharedStore(), {
    method: request.method,
    path: `/${path.join("/")}`,
    query: Object.fromEntries(url.searchParams),
    body,
  });

  return json(result.body, result.status);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
