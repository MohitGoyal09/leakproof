import { appendFileSync } from "node:fs";
import { CHECKS } from "./checks.js";
import { safeHref } from "./report/html.js";
import { clean } from "./report/terminal.js";
import type { Finding, FullReport, ScanReport } from "./types.js";

type Report = ScanReport | FullReport;

const isFull = (r: Report): r is FullReport => "before" in r;
/** The leaks still open: the final scan of a fix run, or the scan itself. */
const openLeaks = (r: Report): Finding[] => (isFull(r) ? (r.after ?? r.before).findings : r.findings);

// GitHub workflow commands: page text must not end the line or start a new command.
const noControl = (t: string) => t.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, "");
const escapeData = (t: string) => noControl(t).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (t: string) => escapeData(t).replace(/:/g, "%3A").replace(/,/g, "%2C");

const lastScan = (r: Report): ScanReport => (isFull(r) ? (r.after ?? r.before) : r);

/** One `::error` line per open leak and per check that could not run, shown inline on the workflow run. */
export function annotations(report: Report): string[] {
  const errors = lastScan(report).errors.map((e) => `::error title=${escapeProperty(`Leakproof: check could not run (${e.unit})`)}::${escapeData(e.message)}`);
  return [...errors, ...openLeaks(report).map((f) => {
    const title = escapeProperty(`Leakproof: ${CHECKS[f.check].label} (${f.flow})`);
    const message = escapeData(f.evidence[0] ? `${f.title}. ${f.evidence[0]}` : f.title);
    return `::error title=${title}::${message}`;
  })];
}

// Page text: no markup, no table breaks, no links (a zero-width space after ":" stops GitHub's auto-linking).
const cell = (t: string) =>
  clean(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([|[\]\\`*_])/g, "\\$1").replace(/:\/\//g, ":\u200b//").replace(/\bwww\./gi, "www\u200b.");
const plural = (n: number) => `${n} leak${n === 1 ? "" : "s"}`;

/** Markdown for the job summary: the count, then one row per open leak with its Kane run. */
export function stepSummary(report: Report): string {
  const leaks = openLeaks(report);
  const before = isFull(report) ? report.before : report;
  const errors = lastScan(report).errors.length;
  const notRun = errors > 0 ? `, ${errors} check${errors === 1 ? "" : "s"} could not run` : "";
  const head = isFull(report) && report.after
    ? `## Leakproof: ${report.before.findings.length} → ${plural(leaks.length)}${notRun}`
    : `## Leakproof: ${leaks.length === 0 && errors === 0 ? "no leaks found" : `${plural(leaks.length)} found${notRun}`}`;
  const credits = Math.round(before.credits + (isFull(report) ? (report.after?.credits ?? 0) + (report.extraCredits ?? 0) : 0));
  const rows = leaks.map((f) => {
    const link = safeHref(f.testUrl);
    return `| ${cell(CHECKS[f.check].label)} | ${cell(f.flow)} | ${cell(f.title)} | ${link ? `[Kane run](${link})` : ""} |`;
  });
  const table = rows.length > 0 ? ["", "| Check | Flow | Leak | Evidence |", "|---|---|---|---|", ...rows] : [];
  return [head, "", `${cell(before.url)} · ${before.units} checks · ${credits} Kane credits`, ...table, ""].join("\n");
}

/** Inside GitHub Actions: print annotations and append the job summary. Does nothing elsewhere. */
export function writeCiOutputs(report: Report, env: NodeJS.ProcessEnv, out: (line: string) => void): void {
  if (env.GITHUB_ACTIONS !== "true") return;
  for (const line of annotations(report)) out(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, stepSummary(report));
}
