import { flagBool, type ParsedArgs } from "./args.js";
import { runVerifyTests } from "./commands/verify-tests.js";
import { paint } from "./ui.js";

const HELP = `groundtrace — see where the numbers on your screen actually came from

Usage
  groundtrace <command> [options]

Commands
  init                    Add GroundTrace config to an existing Next.js project
  run                     Start the app + correlation server + overlay together
  verify-tests -- <cmd>   Run a test command and report the real evidence
  verify                  Build + tests + provenance scan, printed as one report
  report                  Print the last verify run without re-running anything

Options
  --quiet                 Suppress the report box (exit code still reflects it)
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

  switch (args.command) {
    case "verify-tests": {
      const command = commandFrom(args);
      if (command === undefined) {
        console.error("usage: groundtrace verify-tests -- <test command>");
        return 1;
      }
      return runVerifyTests(command, { quiet: flagBool(args, "quiet") });
    }
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
