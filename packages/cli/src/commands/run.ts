/**
 * `groundtrace run` — the app, the correlation server, and overlay injection,
 * from one command.
 *
 * The app keeps its own port; GroundTrace's port is the one you open. Requests
 * pass straight through except `/__groundtrace/*`, and HTML gets one script tag
 * added on the way out.
 */
import { startApp, waitForApp } from "../app-process.js";
import { loadConfig, type GroundTraceConfig } from "../config.js";
import { startCollectorServer } from "../server.js";
import { paint } from "../ui.js";

export interface RunOptions {
  cwd: string;
  port?: number;
  appPort?: number;
  /** Don't start the app; just proxy to one that's already running. */
  attach?: boolean;
  configOverrides?: Partial<GroundTraceConfig>;
}

export async function runRun(options: RunOptions): Promise<number> {
  const config = { ...loadConfig(options.cwd), ...options.configOverrides };
  const port = options.port ?? config.port;
  const appPort = options.appPort ?? config.appPort;
  const appUrl = `http://127.0.0.1:${appPort}`;

  const collector = await startCollectorServer({ port, proxyTo: appUrl });

  const app = options.attach
    ? undefined
    : startApp({
        command: config.dev,
        cwd: options.cwd,
        env: {
          GROUNDTRACE_COLLECTOR_URL: collector.url,
          PORT: String(appPort),
        },
      });

  console.log("");
  console.log(paint("GROUNDTRACE", "bold"));
  console.log(`  app          ${appUrl}${options.attach ? " (attached)" : ""}`);
  console.log(`  collector    ${collector.url}/__groundtrace`);
  console.log(`  ${paint("open", "green")}         ${collector.url}`);
  console.log("");
  console.log(paint("  dev mode only — do not run this in production", "gray"));
  console.log("");

  const ready = await waitForApp(appUrl, 90_000);
  if (!ready) {
    console.error(
      paint(`the app never became reachable at ${appUrl}`, "red") +
        ` — check that \`${config.dev}\` starts it on port ${appPort}`,
    );
    await app?.stop();
    await collector.close();
    return 1;
  }

  console.log(paint(`  ready — click any tracked value at ${collector.url}`, "green"));
  console.log("");

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void (async () => {
        console.log("");
        await app?.stop();
        await collector.close();
        resolve();
      })();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    app?.child.once("exit", shutdown);
  });

  return 0;
}
