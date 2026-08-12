/**
 * The local correlation server, and the overlay injection that comes with it.
 *
 * It is one process doing two jobs:
 *   1. hosting the collector (`/__groundtrace/*`), and
 *   2. reverse-proxying everything else to the app, rewriting HTML responses on
 *      the way through to add one `<script>` tag.
 *
 * The proxy is what makes `groundtrace run` a single command for a project that
 * hasn't imported the overlay itself — otherwise "add this script tag to your
 * layout" would be a manual step, and manual steps in a debugging tool are how
 * you end up debugging the debugger.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import {
  COLLECTOR_BASE,
  EventStore,
  handleCollectorRequest,
  type CollectorOptions,
} from "@groundtrace/core";

export const OVERLAY_PATH = `${COLLECTOR_BASE}/overlay.js`;

export interface CollectorServerOptions {
  port: number;
  host?: string;
  /** When set, everything outside `/__groundtrace/*` is proxied to this origin. */
  proxyTo?: string;
  store?: EventStore;
  collectorOptions?: CollectorOptions;
}

export interface CollectorServer {
  server: Server;
  store: EventStore;
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Reads the prebuilt IIFE out of `@groundtrace/overlay`. */
export function overlayScript(): string {
  const require = createRequire(import.meta.url);
  const path = require.resolve("@groundtrace/overlay/overlay.global.js");
  return readFileSync(path, "utf-8");
}

const INJECT_MARKER = "groundtrace-overlay-script";

export function injectOverlayTag(html: string): string {
  if (html.includes(INJECT_MARKER)) return html;
  const tag = `<script src="${OVERLAY_PATH}" data-${INJECT_MARKER} defer></script>`;

  const head = html.indexOf("</head>");
  if (head !== -1) return `${html.slice(0, head)}${tag}${html.slice(head)}`;

  const body = html.indexOf("</body>");
  if (body !== -1) return `${html.slice(0, body)}${tag}${html.slice(body)}`;

  return html + tag;
}

export async function startCollectorServer(
  options: CollectorServerOptions,
): Promise<CollectorServer> {
  const store = options.store ?? new EventStore();
  const host = options.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

    if (url.pathname === OVERLAY_PATH) {
      serveOverlay(res);
      return;
    }

    if (url.pathname.startsWith(COLLECTOR_BASE)) {
      void serveCollector(store, req, res, url, options.collectorOptions ?? {});
      return;
    }

    if (options.proxyTo !== undefined) {
      proxy(req, res, options.proxyTo);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  // HMR and other dev-server websockets have to keep working through the proxy.
  if (options.proxyTo !== undefined) {
    const target = new URL(options.proxyTo);
    server.on("upgrade", (req, socket, head) => {
      forwardUpgrade(req, socket as Socket, head, target);
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : options.port;

  return {
    server,
    store,
    port,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => {
          resolve();
        });
      }),
  };
}

function serveOverlay(res: ServerResponse): void {
  try {
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(overlayScript());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`groundtrace overlay bundle unavailable: ${message}`);
  }
}

async function serveCollector(
  store: EventStore,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  collectorOptions: CollectorOptions,
): Promise<void> {
  let body: unknown;
  if (req.method === "POST") {
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
  }

  const result = handleCollectorRequest(
    store,
    {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    },
    collectorOptions,
  );

  res.writeHead(result.status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(result.body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function proxy(req: IncomingMessage, res: ServerResponse, target: string): void {
  const targetUrl = new URL(target);

  const upstream = httpRequest(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: targetUrl.host,
        // HTML has to be rewritten on the way through, and rewriting gzip'd
        // bytes as if they were text produces exactly the binary soup you would
        // expect. Asking for identity is the cheap fix, and this is a localhost
        // dev proxy where the extra bytes cost nothing.
        "accept-encoding": "identity",
      },
    },
    (upstreamRes) => {
      const contentType = String(upstreamRes.headers["content-type"] ?? "");
      const isHtml = contentType.includes("text/html");

      if (!isHtml) {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
        return;
      }

      // HTML has to be buffered to be rewritten, so drop any length/encoding
      // headers that describe the original bytes.
      const chunks: Buffer[] = [];
      upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        const html = injectOverlayTag(Buffer.concat(chunks).toString("utf-8"));
        const headers = { ...upstreamRes.headers };
        // The body just changed length; the original header no longer describes it.
        delete headers["content-length"];
        res.writeHead(upstreamRes.statusCode ?? 200, headers);
        res.end(html);
      });
    },
  );

  upstream.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`groundtrace could not reach the app at ${target}: ${error.message}`);
  });

  req.pipe(upstream);
}

function forwardUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  target: URL,
): void {
  const upstream = httpRequest({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: target.host },
  });

  upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = Object.entries(upstreamRes.headers).map(
      ([key, value]) =>
        `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`,
    );
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length > 0) socket.unshift(upstreamHead);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });

  upstream.on("error", () => {
    socket.destroy();
  });

  if (head.length > 0) upstream.write(head);
  upstream.end();
}
