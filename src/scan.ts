import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startApp } from "./app.js";
import { dedupe, readEvidencePack, toFinding } from "./findings.js";
import { runKane } from "./kane.js";
import { buildUnits } from "./objective.js";
import { mapLimit } from "./pool.js";
import type { CheckId, Config, Finding, KaneResult, RunUnit, ScanReport, UnitResult } from "./types.js";

export class ScanOptionError extends Error {
  override name = "ScanOptionError";
}

export interface ScanOptions {
  only?: CheckId;
  flow?: string;
  concurrency?: number;
  manageApp?: boolean;
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
export async function runUnit(config: Config, unitId: string): Promise<{ unit: RunUnit; result: KaneResult }> {
  const unit = buildUnits(config).find((u) => u.id === unitId);
  if (!unit) throw new ScanOptionError(`Unknown check "${unitId}".`);
  return { unit, result: await runKane(unit, kaneOptions(config)) };
}

/** Turn a unit's Kane result into a finding, pulling exact evidence from the run's evidence pack. */
export function findingFor(config: Config, unit: RunUnit, result: KaneResult): Finding | null {
  if (result.status !== "failed") return null;
  const pack = result.sessionDir ? readEvidencePack(result.sessionDir, join(outDir(config), "evidence"), unit.id) : undefined;
  return toFinding(unit, result, pack, { appHost: new URL(config.url).host, slowMs: config.vitals.slowMs });
}

/** Scan every (flow, check) unit through Kane and write `.leakproof/findings.json`. */
export async function scan(config: Config, opts: ScanOptions = {}): Promise<ScanReport> {
  const units = selectUnits(config, opts);
  const app = opts.manageApp === false ? undefined : await startApp(config);
  const startedAt = new Date().toISOString();
  try {
    const rows = await mapLimit(units, opts.concurrency ?? SCAN_CONCURRENCY, async (unit) => {
      const result = await runKane(unit, kaneOptions(config));
      const finding = findingFor(config, unit, result) ?? undefined;
      const message = result.status === "error" || result.status === "timeout" ? result.reason ?? result.summary : undefined;
      const row = { unit: unit.id, status: result.status, credits: result.credits };
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
    mkdirSync(outDir(config), { recursive: true });
    writeFileSync(join(outDir(config), "findings.json"), JSON.stringify(report, null, 2));
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
