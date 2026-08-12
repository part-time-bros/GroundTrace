export { parseArgs, flagBool, flagNumber, flagString, type ParsedArgs } from "./args.js";
export { dispatch, printHelp } from "./dispatch.js";
export {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  configPath,
  loadConfig,
  saveConfig,
  type GroundTraceConfig,
} from "./config.js";
export {
  DEFAULT_MCP_ENTRY,
  HOOK_COMMAND,
  MCP_CONFIG_FILENAME,
  MCP_SERVER_NAME,
  alreadyPresent,
  mergeMcpServer,
  mergeStopHook,
  type McpConfig,
  type McpServerEntry,
  type ClaudeSettings,
  type HookEntry,
  type HookMatcher,
} from "./claude-hook.js";
export {
  extractFallbackLiterals,
  extractIds,
  scanProject,
  type ScanResult,
} from "./scan.js";
export {
  OVERLAY_PATH,
  injectOverlayTag,
  overlayScript,
  startCollectorServer,
  type CollectorServer,
  type CollectorServerOptions,
} from "./server.js";
export {
  discoverBrowserPath,
  scanInBrowser,
  type BrowserScanOptions,
  type BrowserScanResult,
} from "./browser.js";
export {
  startApp,
  waitForApp,
  type AppProcess,
  type StartAppOptions,
} from "./app-process.js";
export {
  loadVerifyResult,
  reportPath,
  saveVerifyResult,
  REPORT_DIR,
  REPORT_FILE,
} from "./report-store.js";
export {
  CLAUDE_SETTINGS_PATH,
  detectConfig,
  runInit,
  writeClaudeHook,
  writeMcpConfig,
  type InitOptions,
  type InitResult,
} from "./commands/init.js";
export { runRun, type RunOptions } from "./commands/run.js";
export { runReport, type ReportOptions } from "./commands/report.js";
export {
  formatFlagged,
  formatVerify,
  runVerify,
  toHookPayload,
  toJson,
  verifyExitCode,
  type BuildEvidence,
  type ObservationBasis,
  type ProvenanceEvidence,
  type VerifyOptions,
  type VerifyResult,
} from "./commands/verify.js";
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
