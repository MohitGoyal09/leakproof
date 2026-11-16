import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { execa } from "execa";
import { startApp, type AppHandle } from "./app.js";
import { CHECKS } from "./checks.js";
import { changedFiles, commitAll, createBranch, fixBranchName, isClean, repoRoot, revertAll } from "./git.js";
import { redactSecrets } from "./redact.js";
import { writeReport } from "./report/html.js";
import { findingFor, runUnit, scan, type ScanOptions } from "./scan.js";
import type { Config, Finding, FindingOutcome, FixAttempt, Flow, FullReport, KaneResult } from "./types.js";

export class DirtyTreeError extends Error {
  override name = "DirtyTreeError";
}

export class AgentAuthError extends Error {
  override name = "AgentAuthError";
  constructor() {
    super("Claude Code is not logged in. Open a terminal, run: claude, then type /login. After that, run leakproof fix again.");
  }
}

export interface FixOptions {
  maxAttempts?: number;
  agentTimeoutMs?: number;
  onEvent?: (event: FixEvent) => void;
  onScanResult?: ScanOptions["onResult"];
}

export type FixEvent =
  | { type: "scanned"; findings: number }
  | { type: "attempt"; finding: Finding; attempt: number }
  | { type: "attempt-result"; finding: Finding; result: FixAttempt }
  | { type: "rescan" };

const MAX_ATTEMPTS = 3;
const AGENT_TIMEOUT_MS = 600_000;

function claudeBin(): string {
  return process.env.LEAKPROOF_CLAUDE_BIN || "claude";
}

/** The prompt the coding agent gets for one finding. Contains evidence and placeholders, never secret values. */
export function buildFixPrompt(finding: Finding, flow: Flow, last?: KaneResult, secrets: readonly string[] = []): string {
  const check = CHECKS[finding.check];
  const lines = [
    "Leakproof found a leak with Kane CLI, running this app's real user flow in a real browser. Fix it in this repository.",
    "",
    `Leak: ${finding.title}`,
    `Check: ${check.label}. ${check.why}`,
    `Flow "${flow.name}":`,
    ...flow.steps.map((s, i) => `  ${i + 1}. ${s.do}`),
    `Kane's assertion that failed: ${finding.assertion}`,
  ];
  if (finding.evidence.length > 0) lines.push("What Kane saw:", ...finding.evidence.map((e) => `  - ${e}`));
  lines.push(`Kane's diagnosis: ${finding.reason}`);
  if (finding.suggestion) lines.push(`Kane's suggestion: ${finding.suggestion}`);
  if (last) {
    lines.push("", `Your last attempt did not fix it. Kane re-ran the check and it still failed: ${last.verdict?.rootCause ?? last.reason ?? last.summary}`);
  }
  lines.push(
    "",
    "Rules:",
    "- Make the smallest code change that makes this check pass.",
    "- Do not edit leakproof.yml or disable the check.",
    "- Do not delete features the flow uses.",
    "- Do not commit. Leakproof re-runs Kane and commits only when the check passes.",
  );
  return redactSecrets(lines.join("\n"), secrets);
}

/** Run the coding agent headless in `dir`. ok=false on crash, timeout or missing binary. */
export async function runAgent(dir: string, prompt: string, timeoutMs = AGENT_TIMEOUT_MS): Promise<{ ok: boolean; note?: string }> {
  const res = await execa(claudeBin(), ["-p", prompt, "--permission-mode", "acceptEdits", "--output-format", "json"], {
    cwd: dir,
    timeout: timeoutMs,
    reject: false,
    stdin: "ignore",
  });
  if ((res as { code?: string }).code === "ENOENT") return { ok: false, note: "claude CLI not found" };
  if (res.timedOut) return { ok: false, note: `agent timed out after ${Math.round(timeoutMs / 1000)} s` };
  // Only a failed run counts: a successful agent may well talk about "not logged in" users while fixing a login page.
  if (res.exitCode !== 0 && /not logged in|please run \/login|invalid api key/i.test(`${String(res.stdout)}\n${String(res.stderr)}`)) {
    throw new AgentAuthError();
  }
  if (res.exitCode !== 0) return { ok: false, note: `agent exited with code ${res.exitCode}` };
  return { ok: true };
}

/** Scan, have the agent fix each finding, prove each fix with a Kane re-run, commit it, then re-scan. */
export async function fixAll(config: Config, opts: FixOptions = {}): Promise<FullReport> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const root = await repoRoot(config.configDir);
  if (!(await isClean(root))) {
    throw new DirtyTreeError("Your git tree has uncommitted changes. Please commit or stash them first, so every agent fix is its own reviewable commit.");
  }
  const protectedPath = relative(realpathSync(root), realpathSync(config.configPath));
  // Hash the config too, so the guard holds even when git ignores leakproof.yml.
  const configText = readFileSync(config.configPath);
  const configHash = createHash("sha256").update(configText).digest("hex");
  const configChanged = () => {
    try {
      return createHash("sha256").update(readFileSync(config.configPath)).digest("hex") !== configHash;
    } catch {
      return true;
    }
  };
  let app: AppHandle = await startApp(config);
  try {
    await createBranch(root, fixBranchName());
  } catch (error: unknown) {
    await app.stop();
    throw error;
  }
  const restart = async () => {
    await app.stop();
    app = await startApp(config);
  };
  /** Restart after an agent edit. Returns why the app failed to start, or undefined when it is up. */
  const restartAfterEdit = async (): Promise<string | undefined> => {
    try {
      await restart();
      return undefined;
    } catch (error: unknown) {
      return redactSecrets(error instanceof Error ? error.message : String(error), Object.values(config.secrets));
    }
  };

  try {
    const before = await scan(config, { manageApp: false, onResult: opts.onScanResult });
    opts.onEvent?.({ type: "scanned", findings: before.findings.length });
    const outcomes: FindingOutcome[] = [];

    for (const finding of before.findings) {
      const flow = config.flows.find((f) => f.name === finding.flow) as Flow;
      const attempts: FixAttempt[] = [];
      let last: KaneResult | undefined;
      let fixed = false;
      const record = (a: FixAttempt) => {
        attempts.push(a);
        opts.onEvent?.({ type: "attempt-result", finding, result: a });
      };

      for (let attempt = 1; attempt <= maxAttempts && !fixed; attempt++) {
        opts.onEvent?.({ type: "attempt", finding, attempt });
        let agent: { ok: boolean; note?: string };
        try {
          agent = await runAgent(root, buildFixPrompt(finding, flow, last, Object.values(config.secrets)), opts.agentTimeoutMs);
        } catch (error: unknown) {
          await revertAll(root);
          if (configChanged()) writeFileSync(config.configPath, configText);
          throw error;
        }
        const files = await changedFiles(root);
        if (!agent.ok) {
          await revertAll(root);
          if (configChanged()) writeFileSync(config.configPath, configText);
          record({ attempt, files, verdict: "error", note: agent.note });
          continue;
        }
        if (files.length === 0 && !configChanged()) {
          record({ attempt, files, verdict: "still-failing", note: "the agent changed no files" });
          continue;
        }
        if (files.includes(protectedPath) || configChanged()) {
          await revertAll(root);
          writeFileSync(config.configPath, configText);
          record({ attempt, files, verdict: "rejected", note: `the agent edited ${protectedPath}` });
          continue;
        }
        const startError = await restartAfterEdit();
        if (startError) {
          await revertAll(root);
          if (configChanged()) writeFileSync(config.configPath, configText);
          await restart();
          last = { status: "error", exitCode: 2, summary: `The app failed to start after your change: ${startError}`, finalState: {} };
          record({ attempt, files, verdict: "error", note: "the app failed to start after the change" });
          continue;
        }
        const { unit, result } = await runUnit(config, finding.id);
        if (result.status === "passed") {
          await commitAll(root, `fix: leakproof ${finding.check} in ${finding.flow}`);
          record({ attempt, files, verdict: "fixed" });
          fixed = true;
        } else {
          last = result;
          await revertAll(root);
          await restart();
          record({ attempt, files, verdict: "still-failing", note: result.status === "failed" ? undefined : `Kane ${result.status}` });
          const refreshed = findingFor(config, unit, result);
          if (refreshed) Object.assign(finding, { evidence: refreshed.evidence.length ? refreshed.evidence : finding.evidence });
        }
      }
      outcomes.push({ finding, attempts, fixed });
    }

    opts.onEvent?.({ type: "rescan" });
    await restart();
    const after = await scan(config, { manageApp: false, onResult: opts.onScanResult });
    const report: FullReport = { before, outcomes, after };
    writeReport(config.configDir, report, Object.values(config.secrets));
    return report;
  } finally {
    await app.stop();
  }
}
