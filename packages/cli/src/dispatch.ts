import { resolve } from "node:path";
import { flagBool, flagNumber, flagString, type ParsedArgs } from "./args.js";
import { runInit } from "./commands/init.js";
import { runReport } from "./commands/report.js";
import { runRun } from "./commands/run.js";
import {
  formatFlagged,
  formatVerify,
  runVerify,
  verifyExitCode,
} from "./commands/verify.js";
import { runVerifyTests } from "./commands/verify-tests.js";
import { saveVerifyResult } from "./report-store.js";
import { paint } from "./ui.js";

const HELP = `groundtrace — see where the numbers on your screen actually came from

Usage
  groundtrace <command> [options]

Commands
  init                    Add GroundTrace config to an existing Next.js project
                            --claude-code-hook  also add a Claude Code Stop hook
                            --force             overwrite an existing config
  run                     Start the app + correlation server + overlay together
                            --port <n>          port to open (default 7777)
                            --app-port <n>      port the app itself uses
                            --attach            proxy to an app that's already running
  verify-tests -- <cmd>   Run a test command and report the real evidence
  verify                  Build + tests + provenance scan, printed as one report
                            --skip-build        skip the build step
                            --skip-tests        skip the test step
                            --url <url>         scan an app that's already running
                            --no-browser        skip the real-DOM scan
                            --browser-path <p>  explicit Chromium binary
  report                  Print the last verify run without re-running anything
                            --id <value-id>     print one value's provenance tree
                            --json              print the raw saved result

Options
  --cwd <dir>             Project directory (default: current)
  --quiet                 Suppress output (exit code still reflects the result)
  --help                  Show this message

Examples
  groundtrace verify-tests -- pytest -q
  groundtrace run --cwd examples/dashboard-demo
  groundtrace report --id revenue
`;

export function printHelp(): void {
  console.log(HELP);
}

export async function dispatch(args: ParsedArgs): Promise<number> {
  if (flagBool(args, "help") || flagBool(args, "h")) {
    printHelp();
    return 0;
  }

  const cwd = resolve(flagString(args, "cwd", process.cwd()));
  const quiet = flagBool(args, "quiet");

  switch (args.command) {
    case "init": {
      runInit({
        cwd,
        claudeCodeHook: flagBool(args, "claude-code-hook"),
        force: flagBool(args, "force"),
        quiet,
      });
      return 0;
    }

    case "run":
      return runRun({
        cwd,
        ...(args.flags["port"] !== undefined
          ? { port: flagNumber(args, "port", 7777) }
          : {}),
        ...(args.flags["app-port"] !== undefined
          ? { appPort: flagNumber(args, "app-port", 3000) }
          : {}),
        attach: flagBool(args, "attach"),
      });

    case "verify-tests": {
      const command = commandFrom(args);
      if (command === undefined) {
        console.error("usage: groundtrace verify-tests -- <test command>");
        return 1;
      }
      return runVerifyTests(command, { quiet });
    }

    case "verify": {
      const result = await runVerify({
        cwd,
        quiet,
        skipBuild: flagBool(args, "skip-build"),
        skipTests: flagBool(args, "skip-tests"),
        noBrowser: flagBool(args, "no-browser"),
        ...(flagString(args, "browser-path") !== undefined
          ? { browserPath: flagString(args, "browser-path")! }
          : {}),
        ...(flagString(args, "url") !== undefined
          ? { appUrl: flagString(args, "url")! }
          : {}),
      });

      saveVerifyResult(cwd, result);

      if (!quiet) {
        console.log(formatVerify(result));
        const flagged = formatFlagged(result);
        if (flagged.length > 0) {
          console.log("");
          for (const line of flagged) console.log(line);
        }
      }

      return verifyExitCode(result);
    }

    case "report":
      return runReport({
        cwd,
        ...(flagString(args, "id") !== undefined ? { id: flagString(args, "id")! } : {}),
        json: flagBool(args, "json"),
      });

    default:
      console.error(`${paint("unknown command", "red")}: ${args.command}\n`);
      printHelp();
      return 1;
  }
}

/** `-- pytest -q` and `"pytest -q"` should both work. */
function commandFrom(args: ParsedArgs): string | undefined {
  if (args.passthrough.length > 0) return args.passthrough.join(" ");
  if (args.positionals.length > 0) return args.positionals.join(" ");
  return undefined;
}
