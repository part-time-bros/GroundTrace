/**
 * Starting (and reliably stopping) the app under observation.
 *
 * `detached: true` plus a negative-PID kill matters here: dev servers spawn
 * child processes, and killing only the shell leaves the real server holding
 * the port — which shows up later as a confusing EADDRINUSE.
 */
import { spawn, type ChildProcess } from "node:child_process";

export interface AppProcess {
  child: ChildProcess;
  /** Tail of the app's own stdout+stderr, when it was captured. */
  output(): string;
  stop(): Promise<void>;
}

export interface StartAppOptions {
  command: string;
  cwd: string;
  /** Extra environment for the app — `run`/`verify` use it to point at the collector. */
  env?: Record<string, string>;
  /** Forward the app's output to this process's stdio. Defaults to true. */
  inherit?: boolean;
}

const MAX_CAPTURED = 4_000;

export function startApp(options: StartAppOptions): AppProcess {
  const capture = options.inherit === false;

  const child = spawn(options.command, {
    shell: true,
    cwd: options.cwd,
    detached: true,
    // Captured rather than discarded: when the app fails to start, its own
    // output is the only thing that explains why ("Another next dev server is
    // already running", a port clash, a missing script), and swallowing it
    // leaves the user with a bare "never became reachable".
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, ...options.env },
  });

  let captured = "";
  if (capture) {
    const collect = (chunk: Buffer) => {
      captured = (captured + chunk.toString("utf-8")).slice(-MAX_CAPTURED);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
  }

  let stopped = false;

  return {
    child,
    output: () => captured,
    async stop() {
      if (stopped || child.pid === undefined || child.exitCode !== null) return;
      stopped = true;

      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      });

      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          return;
        }
      }

      // Give it a moment to shut down cleanly, then insist.
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 4_000));
      await Promise.race([exited, timeout]);

      if (child.exitCode === null && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    },
  };
}

/**
 * Polls until the app answers, or gives up. Returns whether it came up.
 *
 * `app` lets it bail the moment the process dies rather than serving out the
 * full timeout — a dev server that refuses to start (Next, for one, exits when
 * another instance already owns the project directory) is not going to start
 * ninety seconds later, and the wait only delays a diagnosable error.
 */
export async function waitForApp(
  url: string,
  timeoutMs = 60_000,
  app?: AppProcess,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (app?.child.exitCode !== null && app?.child.exitCode !== undefined) return false;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
        redirect: "manual",
      });
      // Any HTTP answer means something is listening — even a 404 or a redirect.
      if (response.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return false;
}
