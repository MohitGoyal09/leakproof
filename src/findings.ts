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

const GUARDED: Partial<Record<CheckId, RegExp>> = {
  network: /^[A-Z]+ (\S+) returned \d+/,
  vitals: /^[A-Z]+ (\S+) took \d+ ms/,
};

/** Request paths a fix must keep: every failing (network) or slow (vitals) request named in the evidence. */
export function guardedPaths(f: Finding): string[] {
  const pattern = GUARDED[f.check];
  if (!pattern) return [];
  const paths = f.evidence.flatMap((line) => pattern.exec(line)?.[1] ?? []);
  return paths.length > 0 ? [...new Set(paths)] : f.offender ? [f.offender] : [];
}

/**
 * For a passing re-run of a network or vitals finding: true when every guarded request still happens and succeeds,
 * false when one is gone or failing, undefined when there is nothing to judge (no guarded paths, no session, no log).
 */
export function requestsKept(f: Finding, sessionDir: string | undefined, outDir: string): boolean | undefined {
  const paths = guardedPaths(f);
  if (paths.length === 0 || !sessionDir) return undefined;
  const pack = readEvidencePack(sessionDir, outDir, f.id);
  if (pack.har.length === 0) return undefined;
  return paths.every((p) => requestStillSucceeds(pack, p));
}

// Ways to make a console check pass without fixing the error. Each counts only when the edit adds more matches than it removes.
// ponytail: a line-by-line text match; an aliased console (`const c = console; c.error = …`), a catch split over lines or a
// deleted feature gets past it. Closing those needs a behaviour check. Quantifiers are bounded, so a long line stays fast.
const NOT_MEMBER = String.raw`(?<![.\w$])`;
const GLOBAL = String.raw`(?:(?:window|globalThis|self|global)\s*\.\s*)?`;
const ASSIGN = String.raw`(?:\?\?|\|\||&&)?=(?!=)`;
const EMPTY = String.raw`\{\s*(?:\/\*[^*\n]{0,200}\*\/\s*)?\}`;
const SILENCERS: [RegExp, string][] = [
  [
    new RegExp(
      [
        String.raw`${NOT_MEMBER}${GLOBAL}console\s*(?:\.\s*\w{1,40}|\[[^\]\n]{1,60}\])?\s*${ASSIGN}`,
        String.raw`\b(?:const|let|var)\s+console\b`,
        String.raw`\b(?:Object\.(?:defineProperty|defineProperties|assign)|Reflect\.(?:set|defineProperty))\(\s*${GLOBAL}console\b`,
      ].join("|"),
      "g",
    ),
    "replaces console or one of its methods",
  ],
  [
    new RegExp(String.raw`${NOT_MEMBER}${GLOBAL}(?:on(?:error|unhandledrejection)\s*${ASSIGN}|addEventListener\(\s*["'` + "`" + String.raw`](?:error|unhandledrejection)["'` + "`" + "])", "g"),
    "adds a global error handler",
  ],
  [
    new RegExp(
      [
        String.raw`\bcatch\s*(?:\([^)\n]{0,80}\))?\s*${EMPTY}`,
        String.raw`\.catch\(\s*(?:\(\s*\w{0,40}\s*\)|\w{1,40})\s*=>\s*(?:${EMPTY}|undefined|null|void 0|false|true|0|""|''|\[\s*\]|\(\s*\{\s*\}\s*\))\s*\)`,
        String.raw`\.catch\(\s*function\s*\w{0,40}\s*\(\s*\w{0,40}\s*\)\s*${EMPTY}\s*\)`,
      ].join("|"),
      "g",
    ),
    "adds an empty catch that swallows the error",
  ],
  [/\bsuppressHydrationWarning\b/g, "adds suppressHydrationWarning"],
];
const CONSOLE_ERROR = /\bconsole\s*\.\s*error\s*\(/g;

/** A diff line without complete block comments, so an empty block comment between "console" and ".error" cannot hide the call. */
const uncomment = (line: string) => line.replace(/\/\*[^\n]{0,500}?\*\//g, " ");
/** Looks like a comment line. Used only to not count an added, commented-out call: skipping more lines there only rejects more. */
const looksLikeComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line) && !line.includes("*/");

/**
 * Why a console fix hides the error instead of fixing it, read from its diff; undefined when it does not.
 * File headers (from "diff --git" to the first "@@") are skipped; lines outside any file section count as added or removed.
 */
export function silencesConsole(diff: string): string | undefined {
  const added: string[] = [];
  const removed: string[] = [];
  const addedRaw: string[] = [];
  const removedRaw: string[] = [];
  let header = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) header = true;
    else if (line.startsWith("@@")) header = false;
    else if (!header && line.startsWith("+")) (addedRaw.push(line.slice(1)), added.push(uncomment(line.slice(1))));
    else if (!header && line.startsWith("-")) (removedRaw.push(line.slice(1)), removed.push(uncomment(line.slice(1))));
  }
  const count = (side: string[], re: RegExp) => side.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);
  // Fail closed both ways, since stripping comments can misread "/*" inside a string: take the reading that rejects.
  // Every removed line counts, and an added call counts only on a line of code.
  const code = (side: string[]) => side.filter((l) => !looksLikeComment(l));
  const removedCalls = Math.max(count(removed, CONSOLE_ERROR), count(removedRaw, CONSOLE_ERROR));
  const addedCalls = Math.min(count(code(added), CONSOLE_ERROR), count(code(addedRaw), CONSOLE_ERROR));
  if (removedCalls > addedCalls) return "it removes a console.error call";
  const hit = SILENCERS.find(([re]) => count(added, re) > count(removed, re) || count(addedRaw, re) > count(removedRaw, re));
  return hit ? `it ${hit[1]}` : undefined;
}

const TITLE_MAX = 90;

/** A title is one line, at most 90 characters: a console error's stack trace belongs in the evidence, not the heading. */
function shortTitle(text: string): string {
  const line = text.split("\n")[0].replace(/\s+/g, " ").trim();
  return line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/** A finding for a failed run; null for passed, error or timeout (those are not leaks). */
export function toFinding(unit: RunUnit, result: KaneResult, pack?: EvidencePack, ctx?: EvidenceContext): Finding | null {
  if (result.status !== "failed") return null;
  const derived = pack && ctx ? deriveEvidence(unit.check, pack, ctx) : { evidence: [] as string[] };
  const assertion = unit.objective.match(/In this same step, ([^\n]+)/)?.[1] ?? "";
  const label = CHECKS[unit.check].label;
  // Kane sometimes fails an assertion but doubts its own verdict; then its wording is not shown, our raw evidence is.
  const trustVerdict = result.verdict?.confirmed !== false;
  const title = shortTitle(
    trustVerdict && result.verdict?.bugTitle
      ? result.verdict.bugTitle
      : derived.offender
        ? `${label}: ${derived.offender}`
        : `${label} check failed in the ${unit.flow} flow`,
  );
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
