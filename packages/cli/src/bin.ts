#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { dispatch, printHelp } from "./dispatch.js";

const args = parseArgs(process.argv.slice(2));

if (args.command === undefined || args.command === "help") {
  printHelp();
  process.exit(0);
}

dispatch(args)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
