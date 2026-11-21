import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CHECKS } from "./checks.js";
import type { CheckId, Finding, KaneResult, RunUnit } from "./types.js";
import { ownFolder } from "./guard.js";

export interface HarEntry {
  request: { method: string; url: string };
  response: { status: number };
  time: number;
  _resource_type?: string | null;
}

export interface ConsoleLine {
  level?: string;
  text?: string;
}

export interface EvidencePack {
  har: HarEntry[];
  console: ConsoleLine[];
  screenshot?: string;
}

export interface EvidenceContext {
  /** The app URL's hostname, no port. */
  appHostname: string;
  slowMs: number;
}

const MAX_LINES = 5;
const ENV_HOST = /staging|localhost|127\.0\.0\.1|dev\.|internal/i;
const TIMED_TYPES = new Set(["document", "image", "fetch", "xhr"]);

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function uniq(lines: string[]): string[] {
  return [...new Set(lines)].slice(0, MAX_LINES);
}

/** Exact evidence for a finding, read from Kane's HAR and console log. */
export function deriveEvidence(check: CheckId, pack: EvidencePack, ctx: EvidenceContext): { offender?: string; evidence: string[] } {
  switch (check) {
    case "network": {
      const bad = pack.har.filter((e) => e.response.status >= 500);
      return {
        offender: bad[0] && pathOf(bad[0].request.url),
        evidence: uniq(bad.map((e) => `${e.request.method} ${pathOf(e.request.url)} returned ${e.response.status}`)),
      };
    }
    case "vitals": {
      const slow = pack.har
        .filter((e) => e.time > ctx.slowMs && TIMED_TYPES.has(e._resource_type ?? ""))
        .sort((a, b) => b.time - a.time);
      return {
        offender: slow[0] && pathOf(slow[0].request.url),
        evidence: uniq(
          [...slow]
            .sort((a, b) => a.time - b.time)
            .map((e) => `${e.request.method} ${pathOf(e.request.url)} took ${Math.round(e.time)} ms (${e._resource_type})`),
        ),
      };
    }
    case "env-leak": {
      const leaks = pack.har.filter((e) => {
        const host = hostOf(e.request.url);
        return host !== "" && host.replace(/:\d+$/, "") !== ctx.appHostname && ENV_HOST.test(host);
      });
      return {
        offender: leaks[0] && hostOf(leaks[0].request.url),
        evidence: uniq(leaks.map((e) => `${e.request.method} ${e.request.url}`)),
      };
    }
    case "console": {
      const errors = pack.console.filter((c) => c.level === "error" && c.text && !c.text.startsWith("Failed to load resource"));
      return { offender: errors[0]?.text, evidence: uniq(errors.map((c) => c.text as string)) };
    }
    default:
      return { evidence: [] };
  }
}

function unzipText(zip: string, pattern: string): string {
  try {
    return execFileSync("unzip", ["-p", zip, pattern], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return "";
  }
}

/** Read the HAR, console log and failing-step screenshot from a run's `.evidence` zip. Missing pieces stay empty. */
export function readEvidencePack(sessionDir: string, outDir: string, unitId: string): EvidencePack {
  const dir = join(sessionDir, "evidence");
  const zip = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".evidence")) : undefined;
  if (!zip) return { har: [], console: [] };
  const zipPath = join(dir, zip);

  let har: HarEntry[] = [];
  try {
    har = (JSON.parse(unzipText(zipPath, "*/logs/0-network.har") || "{}").log?.entries ?? []) as HarEntry[];
  } catch {
    har = [];
  }
  const consoleLines = unzipText(zipPath, "*/logs/0-console.ndjson")
    .split("\n")
    .flatMap((l): ConsoleLine[] => {
      try {
        return l.trim() ? [JSON.parse(l) as ConsoleLine] : [];
      } catch {
        return [];
      }
    });

  let screenshot: string | undefined;
  const failingStep = /path:\s*(tests\/\S+)\/failure\.yaml/.exec(unzipText(zipPath, "failure.yaml"))?.[1];
  if (failingStep) {
    try {
      // Never unzip through a planted symlink; the rename below replaces a symlinked target itself.
      ownFolder(outDir);
      rmSync(join(outDir, "screenshot.jpg"), { force: true });
      execFileSync("unzip", ["-o", "-j", zipPath, `${failingStep}/screenshot.jpg`, "-d", outDir], { stdio: "ignore" });
      const target = join(outDir, `${unitId.replace(/:/g, "__")}.jpg`);
      renameSync(join(outDir, "screenshot.jpg"), target);
      screenshot = target;
    } catch {
      screenshot = undefined;
    }
  }
  return { har, console: consoleLines, ...(screenshot ? { screenshot } : {}) };
}

/**
 * Whether a passing re-run still made the request a `network` finding was about, and it succeeded.
 * undefined when the run left no network log. Matched on the path, so a changed query is the same request.
 */
export function requestStillSucceeds(pack: EvidencePack, path: string): boolean | undefined {
  if (pack.har.length === 0) return undefined;
  const wanted = path.split("?")[0];
  return pack.har.some((e) => pathOf(e.request.url).split("?")[0] === wanted && e.response.status >= 200 && e.response.status < 400);
}

/** A finding for a failed run; null for passed, error or timeout (those are not leaks). */
export function toFinding(unit: RunUnit, result: KaneResult, pack?: EvidencePack, ctx?: EvidenceContext): Finding | null {
  if (result.status !== "failed") return null;
  const derived = pack && ctx ? deriveEvidence(unit.check, pack, ctx) : { evidence: [] as string[] };
  const assertion = unit.objective.match(/In this same step, ([^\n]+)/)?.[1] ?? "";
  const label = CHECKS[unit.check].label;
  // Kane sometimes fails an assertion but doubts its own verdict; then its wording is not shown, our raw evidence is.
  const trustVerdict = result.verdict?.confirmed !== false;
  const title =
    trustVerdict && result.verdict?.bugTitle
      ? result.verdict.bugTitle
      : derived.offender
        ? `${label}: ${derived.offender}`
        : `${label} check failed in the ${unit.flow} flow`;
  const evidenceText = derived.evidence.length > 0 ? ` Evidence: ${derived.evidence.join("; ")}.` : "";
  const reason = trustVerdict
    ? result.verdict?.rootCause ?? result.reason ?? result.summary
    : `Kane's check failed: ${assertion.replace(/^assert that /, "")}${evidenceText}`;
  return {
    id: unit.id,
    check: unit.check,
    flow: unit.flow,
    assertion,
    offender: derived.offender,
    evidence: derived.evidence,
    title,
    reason,
    summary: result.summary,
    suggestion: result.verdict?.suggestion,
    runDir: result.runDir,
    testUrl: result.testUrl,
    screenshot: pack?.screenshot,
  };
}

/** One finding per check and offender; findings without an offender stay per flow. */
export function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.check}|${f.offender ?? `flow:${f.flow}`}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
