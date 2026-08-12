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

export function startApp(options: StartAppOptions): AppProcess {
  const child = spawn(options.command, {
    shell: true,
    cwd: options.cwd,
    detached: true,
    stdio: options.inherit === false ? "ignore" : "inherit",
    env: { ...process.env, ...options.env },
  });

  let stopped = false;

  return {
    child,
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

/** Polls until the app answers, or gives up. Returns whether it came up. */
export async function waitForApp(url: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
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
