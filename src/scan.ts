import { join } from "node:path";
import { startApp } from "./app.js";
import { dedupe, readEvidencePack, toFinding } from "./findings.js";
import { runKane } from "./kane.js";
import { buildUnits } from "./objective.js";
import { mapLimit } from "./pool.js";
import { redactSecrets } from "./redact.js";
import type { CheckId, Config, Finding, KaneResult, RunUnit, ScanReport, UnitResult } from "./types.js";
import { writeOwnFile } from "./guard.js";

export class ScanOptionError extends Error {
  override name = "ScanOptionError";
}

export interface ScanOptions {
  only?: CheckId;
  flow?: string;
  concurrency?: number;
  manageApp?: boolean;
  /** Re-run a failed check before it counts; on a split, a third run decides. */
  confirm?: boolean;
  onResult?: (result: UnitResult & { finding?: Finding; message?: string }) => void;
}

const SCAN_CONCURRENCY = 4;

export function outDir(config: Config): string {
  return join(config.configDir, ".leakproof");
}

function selectUnits(config: Config, opts: ScanOptions): RunUnit[] {
  if (opts.flow && !config.flows.some((f) => f.name === opts.flow)) {
    throw new ScanOptionError(`No flow named "${opts.flow}". Flows in this config: ${config.flows.map((f) => f.name).join(", ")}`);
  }
  return buildUnits(config).filter((u) => (!opts.only || u.check === opts.only) && (!opts.flow || u.flow === opts.flow));
}

function kaneOptions(config: Config) {
  return { url: config.url, secrets: config.secrets, outDir: join(outDir(config), "runs") };
}

/** Run one unit by id against an app that is already running. Never starts or stops the app. */
export async function runUnit(config: Config, unitId: string, confirm?: Confirm): Promise<Verdict & { unit: RunUnit }> {
  const unit = buildUnits(config).find((u) => u.id === unitId);
  if (!unit) throw new ScanOptionError(`Unknown check "${unitId}".`);
  return { unit, ...(await verdict(config, unit, confirm)) };
}

/** Turn a unit's Kane result into a finding, pulling exact evidence from the run's evidence pack. */
export function findingFor(config: Config, unit: RunUnit, result: KaneResult): Finding | null {
  if (result.status !== "failed") return null;
  const pack = result.sessionDir ? readEvidencePack(result.sessionDir, join(outDir(config), "evidence"), unit.id) : undefined;
  const finding = toFinding(unit, result, pack, { appHostname: new URL(config.url).hostname, slowMs: config.vitals.slowMs });
  if (!finding) return null;
  const secrets = Object.values(config.secrets);
  const r = (t: string) => redactSecrets(t, secrets);
  return {
    ...finding,
    title: r(finding.title),
    reason: r(finding.reason),
    summary: r(finding.summary),
    suggestion: finding.suggestion && r(finding.suggestion),
    offender: finding.offender && r(finding.offender),
    evidence: finding.evidence.map(r),
  };
}

/** Which Kane verdict to re-check: a scan re-checks failures; a fix's proof re-checks passes. */
export type Confirm = "failed" | "passed";

export interface Verdict {
  result: KaneResult;
  /** Each run's status, when the verdict was re-checked. */
  votes?: KaneResult["status"][];
  /** Credits of every run. */
  credits: number;
}

/**
 * One unit's verdict. When the first run says `confirm`, Kane runs it again; if the second run says the opposite, a
 * third run decides. A run that errors cannot vote: with no majority, the error wins and nothing is counted.
 */
export async function verdict(config: Config, unit: RunUnit, confirm?: Confirm): Promise<Verdict> {
  const run = (tag?: string) => runKane(unit, { ...kaneOptions(config), ...(tag ? { tag } : {}) });
  const first = await run();
  if (!confirm || first.status !== confirm) return { result: first, credits: first.credits ?? 0 };
  const runs = [first, await run("vote2")];
  if (runs[1].status === (confirm === "failed" ? "passed" : "failed")) runs.push(await run("vote3"));
  const votes = runs.map((r) => r.status);
  const credits = runs.reduce((sum, r) => sum + (r.credits ?? 0), 0);
  const fails = votes.filter((v) => v === "failed").length;
  const passes = votes.filter((v) => v === "passed").length;
  // A counted failure keeps the first failing run's evidence; a pass reports the last passing run.
  const result =
    fails > passes
      ? runs.find((r) => r.status === "failed")!
      : passes > fails
        ? runs.filter((r) => r.status === "passed").at(-1)!
        : runs.find((r) => r.status !== "passed" && r.status !== "failed") ?? runs.at(-1)!;
  return { result, votes, credits };
}

/** Scan every (flow, check) unit through Kane and write `.leakproof/findings.json`. */
export async function scan(config: Config, opts: ScanOptions = {}): Promise<ScanReport> {
  const units = selectUnits(config, opts);
  const app = opts.manageApp === false ? undefined : await startApp(config);
  const startedAt = new Date().toISOString();
  try {
    const rows = await mapLimit(units, opts.concurrency ?? SCAN_CONCURRENCY, async (unit) => {
      const { result, votes, credits } = await verdict(config, unit, opts.confirm ? "failed" : undefined);
      const finding = findingFor(config, unit, result) ?? undefined;
      const message =
        result.status === "error" || result.status === "timeout"
          ? redactSecrets(result.reason ?? result.summary, Object.values(config.secrets))
          : undefined;
      const row: UnitResult = { unit: unit.id, status: result.status, credits, ...(votes ? { votes } : {}) };
      opts.onResult?.({ ...row, finding, message });
      return { row, finding, message };
    });

    const report: ScanReport = {
      startedAt,
      url: config.url,
      units: units.length,
      results: rows.map((r) => r.row),
      findings: dedupe(rows.flatMap((r) => (r.finding ? [r.finding] : []))),
      errors: rows.flatMap((r) => (r.message ? [{ unit: r.row.unit, message: r.message }] : [])),
      credits: Math.round(rows.reduce((sum, r) => sum + (r.row.credits ?? 0), 0) * 10) / 10,
    };
    writeOwnFile(join(outDir(config), "findings.json"), JSON.stringify(report, null, 2));
    return report;
  } finally {
    await app?.stop();
  }
}

/** 0 no leaks, 1 leaks found, 2 a Kane or app error. */
export function exitCodeFor(report: ScanReport): 0 | 1 | 2 {
  if (report.errors.length > 0) return 2;
  return report.findings.length > 0 ? 1 : 0;
}
