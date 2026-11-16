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
const STOP_GRACE_MS = 5_000;
const PORT_FREE_MS = 5_000;

/** Apps started by this process, so a Ctrl-C handler can stop them all. */
const live = new Set<AppHandle>();

export async function stopAllApps(): Promise<void> {
  await Promise.all([...live].map((a) => a.stop()));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDown(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (await answers(url))) await new Promise((r) => setTimeout(r, 200));
}

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

  if (await answers(config.url)) {
    throw new AppNotReadyError(
      `Something is already running at ${config.url}. Stop it first, or remove "start" from leakproof.yml to scan the app that is running.`,
    );
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

  const handle: AppHandle = { stop: async () => {}, output: () => lines.join("\n") };
  handle.stop = async (): Promise<void> => {
    live.delete(handle);
    const pid = child.pid;
    if (!pid) return;
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        // group already gone
      }
    };
    if (exited === undefined) {
      signal("SIGTERM");
      await Promise.race([child, new Promise((r) => setTimeout(r, STOP_GRACE_MS))]);
    }
    if (alive(pid) || (await answers(config.url))) signal("SIGKILL");
    await waitUntilDown(config.url, PORT_FREE_MS);
  };
  live.add(handle);
  const stop = handle.stop;

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
  return handle;
}
