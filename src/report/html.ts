import { join, relative } from "node:path";
import { CHECKS } from "../checks.js";
import { redactSecrets as redact } from "../redact.js";
import type { Finding, FindingOutcome, FixAttempt, FullReport } from "../types.js";
import { writeOwnFile } from "../guard.js";
import type { Lesson } from "../lessons.js";


function makeEsc(secrets: readonly string[]) {
  return (value: unknown): string =>
    redact(String(value ?? ""), secrets)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
}

function exhibitRef(i: number): string {
  let n = i;
  let ref = "";
  do {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return ref;
}

/** Only links to Kane's own test manager: the page under test can steer Kane's output. */
function safeHref(url: string | undefined): string | undefined {
  return url && /^https:\/\/([\w-]+\.)*(lambdatest|testmuai)\.com\//.test(url) ? url : undefined;
}

const ATTEMPT_LABEL: Record<FixAttempt["verdict"], string> = {
  fixed: "Fixed, Kane re-run passed",
  "still-failing": "Kane re-run still failed",
  rejected: "Agent change rejected",
  error: "Agent error",
};

const STYLE = `
:root{--paper:#fbfbf9;--ink:#16181d;--ink-2:#5a5f6b;--rule:#dcdcd6;--leak:#b42318;--leak-wash:#fdecea;--sealed:#146c43;--sealed-wash:#e5f3eb;--warn:#8a5a00;--warn-wash:#fbf1dc;
--sans:"Archivo",ui-sans-serif,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;color-scheme:light}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;color:var(--ink);font:400 15px/1.55 var(--sans);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
::selection{background:var(--ink);color:var(--paper)}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}
a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.sheet{max-width:1040px;margin:0 auto;padding:48px 32px 64px}
.cert{display:grid;grid-template-columns:1fr auto;gap:8px 32px;align-items:end;padding-bottom:20px;border-bottom:2px solid var(--ink)}
.mark{font-weight:800;font-stretch:112%;letter-spacing:-.02em;font-size:18px}
h1{grid-column:1;margin:0;font-size:40px;line-height:1.05;font-weight:800;font-stretch:112%;letter-spacing:-.03em}
.specimen{grid-column:2;grid-row:1/3;margin:0;display:grid;grid-template-columns:auto auto;gap:4px 20px;font-size:13px}
.specimen dt{color:var(--ink-2)}
.specimen dd{margin:0;font-weight:600;text-align:right}
.verdict{display:flex;align-items:flex-end;gap:40px;padding:40px 0 32px;border-bottom:1px solid var(--rule);flex-wrap:wrap}
.count{display:grid;gap:4px}
.count .num{font-size:120px;line-height:.85;font-weight:800;font-stretch:112%;letter-spacing:-.04em}
.count.leak .num{color:var(--leak)}
.count.sealed .num{color:var(--sealed)}
.count .label{font-size:15px;color:var(--ink-2)}
.arrow{font-size:56px;line-height:1;color:var(--ink-2);padding-bottom:28px}
.verdict-line{margin:0 0 6px auto;max-width:28ch;font-size:18px;font-weight:600;text-wrap:balance}
.exhibit{display:grid;gap:12px;padding:32px 0;border-bottom:1px solid var(--rule)}
.ex-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:13px}
.ex-ref{font-weight:800;font-stretch:112%;letter-spacing:.02em}
.ex-check{color:var(--ink-2)}
.stamps{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--ink-2)}
.stamp{display:inline-block;padding:3px 8px;border:1.5px solid currentColor;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:.08em}
.stamp.leak{color:var(--leak);background:var(--leak-wash)}
.stamp.sealed{color:var(--sealed);background:var(--sealed-wash)}
.stamp.warn{color:var(--warn);background:var(--warn-wash)}
.exhibit h2{margin:0;font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-.01em;text-wrap:balance;max-width:40ch}
.ex-body{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:32px;align-items:start}
.ex-body.no-shot{grid-template-columns:minmax(0,1fr)}
.why{margin:0;color:var(--ink-2);max-width:65ch}
h3{margin:20px 0 6px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2)}
.readings{margin:0;padding:12px 14px;background:#fff;border:1px solid var(--rule);border-radius:4px;font:13px/1.6 var(--mono);white-space:pre-wrap;word-break:break-word}
.diagnosis{margin:0;max-width:65ch}
.attempts{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.attempts li{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline}
.attempts .n{font-weight:700}
.attempts .files{grid-column:2;font:13px/1.5 var(--mono);color:var(--ink-2)}
.links{margin:16px 0 0;font-size:14px}
figure{margin:0;display:grid;gap:6px}
figure img{width:100%;height:auto;border:1px solid var(--rule);border-radius:4px;display:block}
figcaption{font-size:13px;color:var(--ink-2)}
.clean{padding:40px 0;font-size:18px}
.errors{padding:32px 0;border-bottom:1px solid var(--rule)}
.lessons{padding:32px 0;border-bottom:1px solid var(--rule);display:grid;gap:10px}
.lessons h2{margin:0;font-size:22px}
.lessons p{margin:0;color:var(--ink-2);max-width:65ch}
.lessons ol{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:12px}
.lessons li{display:grid;grid-template-columns:7.5em 1fr;gap:4px 12px;align-items:baseline}
.lessons .stamp{text-align:center;width:100%;box-sizing:border-box}
.lessons .files{grid-column:2;font:13px/1.5 var(--mono);color:var(--ink-2)}
.errors ul{margin:8px 0 0;padding-left:18px}
footer{padding-top:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink-2)}
code{font:13px var(--mono);color:var(--ink)}
@media (max-width:760px){.sheet{padding:28px 16px 48px}.cert{grid-template-columns:1fr}.specimen{grid-column:1;grid-row:auto}.specimen dd{text-align:left}.count .num{font-size:88px}.ex-body{grid-template-columns:1fr}.verdict-line{margin-left:0}}
`;

/** Kane's diagnosis without the evidence it often appends: the report already shows that evidence above it. */
function diagnosis(f: Finding): string {
  return f.evidence.length > 0 ? f.reason.replace(/\s*Evidence:[\s\S]*$/, "") : f.reason;
}

/** Render the report as one HTML file. Every string is escaped and secret values are masked. */
export function renderHtml(report: FullReport, reportDir: string, secrets: readonly string[] = []): string {
  const esc = makeEsc(secrets);
  const { before, after, outcomes } = report;
  const items: FindingOutcome[] = outcomes ?? before.findings.map((finding) => ({ finding, attempts: [], fixed: false }));
  const host = (() => {
    try {
      return new URL(before.url).host;
    } catch {
      return before.url;
    }
  })();
  const fixedCount = items.filter((o) => o.fixed).length;
  const credits = Math.round(before.credits + (after?.credits ?? 0) + (report.extraCredits ?? 0));

  const verdictLine = after
    ? `${fixedCount} of ${items.length} fix${items.length === 1 ? "" : "es"} verified by a Kane re-run.`
    : items.length === 0
      ? "Every check passed in a real browser."
      : "Run leakproof fix to have an agent fix these and Kane prove each fix.";

  const exhibit = (o: FindingOutcome, i: number): string => {
    const f: Finding = o.finding;
    const ref = exhibitRef(i);
    const shot = f.screenshot ? relative(reportDir, f.screenshot) : undefined;
    const readings = f.evidence.length > 0 ? f.evidence : [f.offender ?? f.reason].filter(Boolean);
    const afterStamp = outcomes
      ? `<span aria-hidden="true">→</span><span class="stamp ${o.fixed ? "sealed" : "leak"}">${o.fixed ? "FIXED" : "STILL LEAKING"}</span>`
      : "";
    const attempts =
      o.attempts.length > 0
        ? `<h3>Fix attempts</h3><ol class="attempts">${o.attempts
            .map(
              (a) =>
                `<li><span class="n">${a.attempt}</span><span>${esc(ATTEMPT_LABEL[a.verdict])}${a.note ? ` (${esc(a.note)})` : ""}${
                  safeHref(a.testUrl) ? ` · <a href="${esc(safeHref(a.testUrl) as string)}">Kane run that proves the fix</a>` : ""
                }</span>${
                  a.files.length > 0 ? `<span class="files">${a.files.map(esc).join("<br>")}</span>` : ""
                }</li>`,
            )
            .join("")}</ol>`
        : "";
    const run = safeHref(f.testUrl);
    return `<article class="exhibit" id="exhibit-${ref.toLowerCase()}">
<div class="ex-head"><span class="ex-ref">Exhibit ${ref}</span><span class="ex-check">${esc(CHECKS[f.check].label)} · ${esc(f.flow)} flow</span><span class="stamps"><span class="stamp leak">LEAK</span>${afterStamp}</span></div>
<h2>${esc(f.title)}</h2>
<div class="ex-body${shot ? "" : " no-shot"}"><div>
<p class="why">${esc(CHECKS[f.check].why)}</p>
<h3>What Kane saw</h3><pre class="readings">${readings.map(esc).join("\n")}</pre>
<h3>Kane's diagnosis</h3><p class="diagnosis">${esc(diagnosis(f))}</p>
${attempts}
${run ? `<p class="links"><a href="${esc(run)}" rel="noopener noreferrer">Failing Kane run in Test Manager</a></p>` : ""}
</div>${shot ? `<figure><a href="${esc(shot)}"><img src="${esc(shot)}" alt="Screenshot of the failing step in the ${esc(f.flow)} flow"></a><figcaption>Failing step, captured by Kane. Click to open full size.</figcaption></figure>` : ""}</div>
</article>`;
  };

  const errors = [...before.errors, ...(after?.errors ?? [])];
  const lessons = report.lessons && (report.lessons.used > 0 || report.lessons.learned.length > 0) ? report.lessons : undefined;
  const lessonItem = (l: Lesson): string => {
    const stamp = l.outcome === "passed" ? `<span class="stamp sealed">PROVEN</span>` : `<span class="stamp leak">REJECTED</span>`;
    const what = l.outcome === "passed" ? `Kane's re-run passed. Commit ${esc((l.commit ?? "").slice(0, 7))}.` : `Kane's re-run still failed: ${esc(l.reason ?? "no reason given")}`;
    return `<li>${stamp}<span><strong>${esc(CHECKS[l.check].label)}</strong> · ${esc(l.flow)} flow. ${what}</span><span class="files">${l.files.map(esc).join("<br>")}</span></li>`;
  };
  const lessonsSection = lessons
    ? `<section class="lessons" aria-labelledby="lessons-h"><h2 id="lessons-h">What Kane taught Leakproof</h2>
<p>This run used ${lessons.used} lesson${lessons.used === 1 ? "" : "s"} from earlier runs and saved ${lessons.learned.length} new one${lessons.learned.length === 1 ? "" : "s"} to <code>.leakproof/lessons.json</code>. The next run gives them to the agent, so it does not repeat an edit Kane turned down.</p>
${lessons.learned.length > 0 ? `<ol>${lessons.learned.map(lessonItem).join("")}</ol>` : ""}</section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leakproof report · ${esc(host)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=JetBrains+Mono:wght@400;600&display=swap">
<style>${STYLE}</style>
</head>
<body>
<main class="sheet">
<header class="cert">
<div class="mark">Leakproof</div>
<h1>Leak report</h1>
<dl class="specimen">
<dt>App</dt><dd>${esc(before.url)}</dd>
<dt>Scanned</dt><dd>${esc(new Date(before.startedAt).toUTCString().replace(" GMT", " UTC"))}</dd>
<dt>Checks</dt><dd>${before.units}</dd>
<dt>Kane credits</dt><dd>${credits}</dd>
</dl>
</header>
<section class="verdict" aria-label="Verdict">
<div class="count leak"><span class="num" data-count="before">${items.length}</span><span class="label">leak${items.length === 1 ? "" : "s"} found</span></div>
${after ? `<div class="arrow" aria-hidden="true">→</div><div class="count sealed"><span class="num" data-count="after">${after.findings.length}</span><span class="label">after fixes</span></div>` : ""}
<p class="verdict-line">${esc(verdictLine)}</p>
</section>
${items.length === 0 ? `<p class="clean">No leaks found. Every check passed in a real browser.</p>` : items.map(exhibit).join("\n")}
${lessonsSection}
${errors.length > 0 ? `<section class="errors"><span class="stamp warn">ERRORS</span><ul>${errors.map((e) => `<li><strong>${esc(e.unit)}</strong>: ${esc(e.message)}</li>`).join("")}</ul></section>` : ""}
<footer><span>Every verdict above is a Kane CLI run in a real browser.</span><span>Reproduce: <code>leakproof scan</code></span></footer>
</main>
</body>
</html>
`;
}

/** Write `.leakproof/report.html` under `configDir` and return its path. */
export function writeReport(configDir: string, report: FullReport, secrets: readonly string[] = []): string {
  const dir = join(configDir, ".leakproof");
  const path = join(dir, "report.html");
  writeOwnFile(path, renderHtml(report, dir, secrets));
  return path;
}
