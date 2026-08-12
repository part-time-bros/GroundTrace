export { parseArgs, flagBool, flagNumber, flagString, type ParsedArgs } from "./args.js";
export { dispatch, printHelp } from "./dispatch.js";
export {
  detectRunner,
  formatEvidence,
  parseCounts,
  runVerifyTests,
  statusOf,
  verifyTests,
  type ParsedCounts,
  type TestClaimStatus,
  type TestEvidence,
  type TestRunner,
} from "./commands/verify-tests.js";
