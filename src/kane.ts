import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { redactSecrets } from "./redact.js";
import type { KaneResult, KaneVerdict, RunUnit } from "./types.js";
import { writeOwnFile } from "./guard.js";

export class KaneNotFoundError extends Error {
  override name = "KaneNotFoundError";
  constructor(bin: string) {
    super(`Kane CLI was not found (${bin}). Install it with: npm install -g @testmuai/kane-cli, then run: kane-cli login`);
  }
}

export class KaneAuthError extends Error {
  override name = "KaneAuthError";
  constructor() {
    super("Kane CLI is not logged in. Run: kane-cli login (or kane-cli login --username <u> --access-key <key> in CI), then try again.");
  }
}

// Kane's own words for a lost login. Kane's summary describes the app too, so only Kane-specific
// phrases count there; generic words ("unauthorized") count only on Kane's stderr.
const AUTH_ANYWHERE = /kane-cli login|token (expired|invalid)|invalid token/i;
const AUTH_STDERR = /not (logged|signed) in|login required|unauthori[sz]ed|invalid credentials/i;

export interface RunKaneOptions {
  url: string;
  secrets: Record<string, string>;
  timeoutS?: number;
  outDir: string;
  /** Kill Kane after this long. Default: Kane's own timeout plus a minute. */
  hardTimeoutMs?: number;
  /** Added to the log file names, so a re-check does not overwrite the first run's log. */
  tag?: string;
}

const DEFAULT_TIMEOUT_S = 180;

function kaneBin(): string {
  return process.env.LEAKPROOF_KANE_BIN || "kane-cli";
}

type RawEvent = Record<string, unknown> & { type?: string };

function lastRunEnd(stdout: string): RawEvent | undefined {
  const events = stdout.split("\n").flatMap((line): RawEvent[] => {
    const t = line.trim();
    if (!t.startsWith("{")) return [];
    try {
      return [JSON.parse(t) as RawEvent];
    } catch {
      return [];
    }
  });
  return events.reverse().find((e) => e.type === "run_end");
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function toVerdict(v: unknown): KaneVerdict | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  return {
    bugTitle: str(o.bug_title),
    rootCause: str(o.root_cause),
    suggestion: str(o.suggestion),
    oneLiner: str(o.one_liner),
    confidence: typeof o.confidence === "number" ? o.confidence : undefined,
    confirmed: typeof o.confirmed === "boolean" ? o.confirmed : undefined,
  };
}

/**
 * Turn Kane's NDJSON into a result. Classification uses run_end.reason_code (see docs/kane-assertions.md):
 * success.* passed, assertion_error.* failed (a finding), anything else an error. Exit code alone is not trusted.
 */
export function parseNdjson(stdout: string, exitCode: number): KaneResult {
  const end = lastRunEnd(stdout);
  if (!end) {
    return {
      status: exitCode === 3 ? "timeout" : "error",
      exitCode,
      summary: `Kane exited (code ${exitCode}) without a run_end event.`,
      finalState: {},
    };
  }
  const reasonCode = str(end.reason_code);
  let status: KaneResult["status"];
  if (reasonCode?.startsWith("success")) status = "passed";
  else if (reasonCode?.startsWith("assertion_error")) status = "failed";
  else if (!reasonCode && end.status === "passed" && exitCode === 0) status = "passed";
  else status = exitCode === 3 ? "timeout" : "error";

  const runDir = str(end.run_dir);
  const finalState = (end.final_state && typeof end.final_state === "object" ? end.final_state : {}) as Record<string, string>;
  return {
    status,
    exitCode,
    reasonCode,
    summary: str(end.summary) ?? str(end.one_liner) ?? "",
    reason: str(end.reason),
    verdict: toVerdict(end.verdict),
    finalState,
    runDir,
    sessionDir: str(end.session_dir) ?? runDir?.replace(/\/runs\/\d+$/, ""),
    testUrl: str(end.test_url),
    credits: typeof end.credits_consumed === "number" ? end.credits_consumed : undefined,
  };
}

/** Variables files that exist right now, so an interrupt can delete them (the finally block does not run on exit). */
const liveVarsFiles = new Set<string>();

/** Delete every variables file still on disk. Safe to call from a signal handler. */
export function removeVarsFiles(): void {
  for (const path of liveVarsFiles) rmSync(path, { force: true });
  liveVarsFiles.clear();
}

/**
 * Check the Kane login before any credits are spent. `whoami` costs nothing, and it also refreshes a login
 * that went stale while the machine was idle (seen in real runs: the first run after a long pause failed).
 */
export async function checkKaneLogin(): Promise<void> {
  const bin = kaneBin();
  const res = await execa(bin, ["whoami"], { reject: false, stdin: "ignore", timeout: 60_000 });
  if ((res as { code?: string }).code === "ENOENT") throw new KaneNotFoundError(bin);
  if (res.exitCode !== 0) throw new KaneAuthError();
}

/** Process groups of the Kane runs now going, so a timeout or Ctrl-C can kill each whole tree. */
const liveKane = new Set<number>();

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // group already gone
  }
}

/** Called by the CLI on SIGINT/SIGTERM: Kane runs in its own process group, so the terminal's signal does not reach it. */
export function stopAllKane(): void {
  for (const pid of liveKane) killGroup(pid);
  liveKane.clear();
}

async function runOnce(unit: RunUnit, opts: RunKaneOptions, attempt: number): Promise<KaneResult> {
  const bin = kaneBin();
  const varsPath = join(tmpdir(), `leakproof-vars-${randomUUID()}.json`);
  const vars = Object.fromEntries(Object.entries(opts.secrets).map(([k, value]) => [k, { value, secret: true }]));
  liveVarsFiles.add(varsPath);
  writeFileSync(varsPath, JSON.stringify(vars), { mode: 0o600, flag: "wx" });
  const timeoutS = opts.timeoutS ?? DEFAULT_TIMEOUT_S;
  try {
    // Kane's launcher starts children that keep its output pipe open. Killing only the launcher leaves the
    // pipe open and the run hangs, so Kane gets its own process group and a timeout kills the whole group.
    const child = execa(
      bin,
      ["run", unit.objective, "--url", opts.url, "--agent", "--headless", "--timeout", String(timeoutS), "--variables-file", varsPath],
      { reject: false, stdin: "ignore", detached: true },
    );
    const pid = child.pid;
    if (pid) liveKane.add(pid);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (pid) killGroup(pid);
    }, opts.hardTimeoutMs ?? (timeoutS + 60) * 1000);
    const res = await child.finally(() => {
      clearTimeout(timer);
      if (pid) liveKane.delete(pid);
    });
    if ((res as { code?: string }).code === "ENOENT" || /ENOENT/.test(String(res.message ?? ""))) throw new KaneNotFoundError(bin);
    const secrets = Object.values(opts.secrets);
    const stdout = redactSecrets(typeof res.stdout === "string" ? res.stdout : "", secrets);
    const stderr = redactSecrets(typeof res.stderr === "string" ? res.stderr : "", secrets);
    const base = join(opts.outDir, `${unit.id.replace(/:/g, "__")}${opts.tag ? `.${opts.tag.replace(/[^\w-]/g, "")}` : ""}${attempt > 1 ? `.try${attempt}` : ""}`);
    writeOwnFile(`${base}.ndjson`, stdout);
    writeOwnFile(`${base}.err`, stderr);
    const result = parseNdjson(stdout, timedOut ? 3 : (res.exitCode ?? 2));
    const authProblem =
      result.reasonCode?.startsWith("auth") ||
      (result.status === "error" && (AUTH_STDERR.test(stderr) || AUTH_ANYWHERE.test(`${stderr}\n${result.summary}\n${result.reason ?? ""}`)));
    if (authProblem) throw new KaneAuthError();
    return result;
  } finally {
    rmSync(varsPath, { force: true });
    liveVarsFiles.delete(varsPath);
  }
}

/** Run one unit through Kane. An error or timeout is retried once; a real failure is not. */
export async function runKane(unit: RunUnit, opts: RunKaneOptions): Promise<KaneResult> {
  const first = await runOnce(unit, opts, 1);
  if (first.status !== "error" && first.status !== "timeout") return first;
  const second = await runOnce(unit, opts, 2);
  // Both runs are paid for.
  const credits = (first.credits ?? 0) + (second.credits ?? 0);
  return { ...second, credits: credits > 0 ? credits : undefined };
}
