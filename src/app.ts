import { execa, type ResultPromise } from "execa";
import type { Config } from "./types.js";

export class AppNotReadyError extends Error {
  override name = "AppNotReadyError";
}

export interface AppHandle {
  stop(): Promise<void>;
  output(): string;
}

const READY_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 300_000;
const POLL_MS = 500;
const KEEP_LINES = 20;

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/** Poll `url` until it answers 2xx/3xx. */
export async function waitForReady(url: string, timeoutMs = READY_TIMEOUT_MS, crashed?: () => string | undefined): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const crash = crashed?.();
    if (crash) throw new AppNotReadyError(crash);
    if (await answers(url)) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new AppNotReadyError(`${url} did not respond within ${Math.round(timeoutMs / 1000)} s.`);
}

/** Start the app with `config.start` (if set) and wait until `config.url` answers. */
export async function startApp(config: Config, timeoutMs = START_TIMEOUT_MS): Promise<AppHandle> {
  if (!config.start) {
    await waitForReady(config.url, READY_TIMEOUT_MS);
    return { stop: async () => {}, output: () => "" };
  }

  const lines: string[] = [];
  const keep = (chunk: unknown) => {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    lines.splice(0, Math.max(0, lines.length - KEEP_LINES));
  };
  const child: ResultPromise = execa(config.start, { shell: true, cwd: config.configDir, detached: true, reject: false, stdin: "ignore", all: true });
  child.all?.on("data", keep);
  let exited: number | undefined;
  void child.then((r) => {
    exited = r.exitCode ?? 1;
  });

  const stop = async (): Promise<void> => {
    if (child.pid && exited === undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
      await Promise.race([child, new Promise((r) => setTimeout(r, 5000))]);
    }
  };

  try {
    await waitForReady(config.url, timeoutMs, () =>
      exited === undefined ? undefined : `"${config.start}" exited with code ${exited} before ${config.url} was ready.\n${lines.join("\n")}`,
    );
  } catch (error: unknown) {
    await stop();
    if (error instanceof AppNotReadyError && !error.message.includes("exited")) {
      throw new AppNotReadyError(`${error.message}\nLast output of "${config.start}":\n${lines.join("\n")}`);
    }
    throw error;
  }
  return { stop, output: () => lines.join("\n") };
}
