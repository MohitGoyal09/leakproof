import pc from "picocolors";
import { CHECKS } from "../checks.js";
import type { CheckId, Finding, ScanReport, UnitResult } from "../types.js";

export interface RowInput extends UnitResult {
  finding?: Finding;
  message?: string;
}

const COL_STATUS = 7;
const COL_FLOW = 14;
const COL_CHECK = 22;

/** Remove C0/C1 control characters so text from a scanned page cannot drive the terminal. */
export function clean(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, (c) => (c === "\n" || c === "\t" ? " " : "")).replace(/ {2,}/g, " ").trim();
}

function fit(text: string, max: number): string {
  if (max <= 1) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function badge(status: UnitResult["status"]): string {
  if (status === "failed") return pc.bold(pc.red("LEAK".padEnd(COL_STATUS)));
  if (status === "passed") return pc.green("PASS".padEnd(COL_STATUS));
  return pc.bold(pc.yellow("ERROR".padEnd(COL_STATUS)));
}

/** One fixed-width line per unit, so results never reflow while a scan is filmed. */
export function formatRow(row: RowInput, width: number): string {
  const [flow, check] = row.unit.split(":") as [string, CheckId];
  const label = CHECKS[check]?.label ?? check;
  const detail =
    row.status === "failed"
      ? row.finding?.evidence[0] ?? row.finding?.offender ?? row.finding?.title ?? ""
      : row.status === "passed"
        ? ""
        : row.message ?? "Kane could not finish this check";
  const fixed = 2 + COL_STATUS + COL_FLOW + COL_CHECK;
  const line = `  ${badge(row.status)}${pc.dim(fit(flow, COL_FLOW - 1).padEnd(COL_FLOW))}${fit(label, COL_CHECK - 1).padEnd(COL_CHECK)}`;
  const tail = fit(clean(detail), width - fixed);
  return (line + (row.status === "failed" ? tail : pc.dim(tail))).trimEnd();
}

export function formatHeader(url: string, units: number, flows: number): string {
  return `\n${pc.bold("leakproof")}  ${pc.dim("scanning")} ${clean(url)}  ${pc.dim("·")}  ${units} check${units === 1 ? "" : "s"} across ${flows} flow${flows === 1 ? "" : "s"}\n`;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export function formatSummary(report: ScanReport, elapsedMs: number, reportPath: string): string {
  const leaks = report.findings.length;
  const head =
    leaks === 0
      ? pc.bold(pc.green("No leaks found"))
      : pc.bold(pc.red(`${leaks} leak${leaks === 1 ? "" : "s"} found`));
  const parts = [head];
  if (report.errors.length > 0) parts.push(pc.yellow(`${report.errors.length} error${report.errors.length === 1 ? "" : "s"}`));
  parts.push(pc.dim(`${Math.round(report.credits)} credits`), pc.dim(duration(elapsedMs)));
  return `\n  ${parts.join(pc.dim("  ·  "))}\n  ${pc.dim("Report")}  ${reportPath}\n`;
}
