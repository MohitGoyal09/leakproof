import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { annotations, stepSummary, writeCiOutputs } from "../src/ci.js";
import type { Finding, FullReport, ScanReport } from "../src/types.js";
import { tempDir } from "./helpers.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "home:network", check: "network", flow: "home", assertion: "a", offender: "/api/x",
  evidence: ["GET /api/x returned 500"], title: "Recommendations fail", reason: "r", summary: "s",
  testUrl: "https://test-manager.lambdatest.com/x", ...over,
});
const scan = (findings: Finding[], over: Partial<ScanReport> = {}): ScanReport => ({
  startedAt: "2026-11-23T10:00:00.000Z", url: "http://localhost:3000", units: 6, results: [], findings, errors: [], credits: 41.6, ...over,
});

describe("annotations", () => {
  it("prints one GitHub error per leak, with the check, flow and evidence", () => {
    expect(annotations(scan([finding()]))).toEqual([
      "::error title=Leakproof%3A Hidden server errors (home)::Recommendations fail. GET /api/x returned 500",
    ]);
  });

  it("escapes text so a page cannot inject another workflow command", () => {
    const [line] = annotations(scan([finding({ title: "bad\n::warning::x 100%", evidence: [], flow: "a,b:c" })]));
    expect(line).toBe("::error title=Leakproof%3A Hidden server errors (a%2Cb%3Ac)::bad%0A::warning::x 100%25");
    expect(line.split("\n")).toHaveLength(1);
  });

  it("uses the final scan after a fix run", () => {
    const report: FullReport = { before: scan([finding()]), after: scan([]), outcomes: [] };
    expect(annotations(report)).toEqual([]);
  });
});

describe("stepSummary", () => {
  it("lists each leak as a table row with a link to its Kane run", () => {
    const md = stepSummary(scan([finding()]));
    expect(md).toContain("## Leakproof: 1 leak found");
    expect(md).toContain("| Hidden server errors | home | Recommendations fail | [Kane run](https://test-manager.lambdatest.com/x) |");
    expect(md).toContain("42 Kane credits");
  });

  it("says when there is nothing to fix", () => {
    expect(stepSummary(scan([]))).toContain("## Leakproof: no leaks found");
  });

  it("shows before and after for a fix run", () => {
    expect(stepSummary({ before: scan([finding()]), after: scan([]), outcomes: [] })).toContain("## Leakproof: 1 → 0 leaks");
  });

  it("escapes pipes, links and markup in page text", () => {
    expect(stepSummary(scan([finding({ title: "a | <b>b</b> [x](y)" })]))).toContain("a \\| &lt;b&gt;b&lt;/b&gt; \\[x\\](y)");
  });

  it("only links Kane's own test manager, and no URL that could close the link", () => {
    expect(stepSummary(scan([finding({ testUrl: "https://evil.example/x" })]))).not.toContain("evil.example");
    const md = stepSummary(scan([finding({ testUrl: "https://a.lambdatest.com/x) [Fix now](https://evil.example/p" })]));
    expect(md).not.toContain("evil.example");
  });

  it("does not let a bare URL in page text become a link", () => {
    expect(stepSummary(scan([finding({ title: "log in at https://evil.example/login" })]))).not.toContain("https://evil");
  });

  it("does not say no leaks when a check could not run", () => {
    const md = stepSummary(scan([], { errors: [{ unit: "home:network", message: "Kane crashed" }] }));
    expect(md).not.toContain("no leaks found");
    expect(md).toContain("1 check could not run");
    expect(annotations(scan([], { errors: [{ unit: "home:network", message: "Kane\rcrashed" }] }))).toEqual([
      "::error title=Leakproof%3A check could not run (home%3Anetwork)::Kane%0Dcrashed",
    ]);
  });
});

describe("writeCiOutputs", () => {
  it("does nothing outside GitHub Actions", () => {
    const lines: string[] = [];
    writeCiOutputs(scan([finding()]), {}, (l) => lines.push(l));
    expect(lines).toEqual([]);
  });

  it("prints annotations and appends the summary inside GitHub Actions", () => {
    const file = join(tempDir("lp-ci-"), "summary.md");
    writeFileSync(file, "earlier step\n");
    const lines: string[] = [];
    writeCiOutputs(scan([finding()]), { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: file }, (l) => lines.push(l));
    expect(lines[0]).toMatch(/^::error /);
    expect(readFileSync(file, "utf8")).toMatch(/^earlier step\n[\s\S]*## Leakproof: 1 leak found/);
  });
});
