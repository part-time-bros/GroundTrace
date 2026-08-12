#!/usr/bin/env node
/**
 * stdio entry point. Anything written to stdout other than protocol frames
 * corrupts the stream, so diagnostics go to stderr — which is also where the
 * MCP spec puts them for stdio transports.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const cwdFlag = process.argv.indexOf("--cwd");
const cwd = cwdFlag !== -1 ? process.argv[cwdFlag + 1] : undefined;

const server = createServer(cwd !== undefined ? { cwd } : {});
const transport = new StdioServerTransport();

server
  .connect(transport)
  .then(() => {
    console.error("groundtrace mcp server ready on stdio");
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
