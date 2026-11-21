import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderHtml, writeReport } from "../src/report/html.js";
import type { Finding, FullReport, ScanReport } from "../src/types.js";
import { tempDir } from "./helpers.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "home:network", check: "network", flow: "home", assertion: "assert that no network request returned 500",
  offender: "/api/recommendations", evidence: ["GET /api/recommendations returned 500"],
  title: "Recommendations request fails", reason: "The recommendations service returned an error.", summary: "",
  suggestion: "Restore the service.", testUrl: "https://test-manager.lambdatest.com/x", ...over,
});
const scanReport = (findings: Finding[]): ScanReport => ({
  startedAt: "2026-11-17T10:00:00.000Z", url: "http://localhost:3000", units: 6,
  results: [], findings, errors: [], credits: 118.4,
});

describe("renderHtml", () => {
  it("shows before and after counts", () => {
    const html = renderHtml({ before: scanReport(Array.from({ length: 6 }, (_, i) => finding({ id: `f:${i}` }))), after: scanReport([]) }, "/r");
    expect(html).toMatch(/data-count="before">6</);
    expect(html).toMatch(/data-count="after">0</);
  });

  it("shows only the before count for a scan without fixes", () => {
    const html = renderHtml({ before: scanReport([finding()]) }, "/r");
    expect(html).toMatch(/data-count="before">1</);
    expect(html).not.toContain('data-count="after"');
  });

  it("links the Kane run that proves each fix, and only Kane's own test manager", () => {
    const fixedWith = (testUrl: string) => ({
      before: scanReport([finding({ testUrl: "https://evil.example/phish" })]),
      outcomes: [{ finding: finding({ testUrl: "https://evil.example/phish" }), attempts: [{ attempt: 1, files: ["a.ts"], verdict: "fixed" as const, testUrl }], fixed: true }],
      after: scanReport([]),
    });
    expect(renderHtml(fixedWith("https://test-manager.lambdatest.com/share/proof"), "/r")).toContain('href="https://test-manager.lambdatest.com/share/proof"');
    const html = renderHtml(fixedWith("https://evil.example/proof"), "/r");
    expect(html).not.toContain("evil.example");
  });

  it("does not repeat Kane's evidence inside the diagnosis, and loads screenshots at once", () => {
    const html = renderHtml(
      { before: scanReport([finding({ reason: "Every request finished too slowly. Evidence: GET /api/hero took 3020 ms.", screenshot: "/r/evidence/home__network.jpg" })]) },
      "/r",
    );
    expect(html).toContain("Every request finished too slowly.</p>");
    expect(html).not.toContain("Evidence: GET /api/hero");
    expect(html).not.toContain('loading="lazy"');
    expect(html).toContain('<a href="evidence/home__network.jpg"');
  });

  it("names the failing Kane run", () => {
    const html = renderHtml({ before: scanReport([finding()]) }, "/r");
    expect(html).toContain("Failing Kane run");
  });

  it("escapes page text", () => {
    const html = renderHtml({ before: scanReport([finding({ offender: "<img src=x onerror=alert(1)>", evidence: ["<script>x</script>"] })]) }, "/r");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never contains secret values", () => {
    const html = renderHtml({ before: scanReport([finding({ reason: "signed in with {{SHOP_PASS}}" })]) }, "/r", ["demo123"]);
    expect(html).not.toContain("demo123");
    const leaky = renderHtml({ before: scanReport([finding({ reason: "password demo123 typed" })]) }, "/r", ["demo123"]);
    expect(leaky).not.toContain("demo123");
    expect(leaky).toContain("•••");
  });

  it("renders one exhibit per finding with attempts and verdict", () => {
    const report: FullReport = {
      before: scanReport([finding(), finding({ id: "checkout:cookies", check: "cookies", title: "Cookie lacks HttpOnly" })]),
      outcomes: [
        { finding: finding(), fixed: true, attempts: [{ attempt: 1, files: ["app/api/recommendations/route.ts"], verdict: "fixed" }] },
        { finding: finding({ id: "checkout:cookies", check: "cookies", title: "Cookie lacks HttpOnly" }), fixed: false, attempts: [{ attempt: 1, files: [], verdict: "rejected", note: "edited leakproof.yml" }] },
      ],
      after: scanReport([finding({ id: "checkout:cookies", check: "cookies" })]),
    };
    const html = renderHtml(report, "/r");
    expect(html.match(/class="exhibit"/g)).toHaveLength(2);
    expect(html).toContain("Exhibit A");
    expect(html).toContain("FIXED");
    expect(html).toContain("STILL LEAKING");
    expect(html).toContain("app/api/recommendations/route.ts");
    expect(html).toContain("rejected");
  });

  it("links evidence: Kane run and a relative screenshot", () => {
    const html = renderHtml({ before: scanReport([finding({ screenshot: "/r/evidence/home__network.jpg" })]) }, "/r");
    expect(html).toContain('href="https://test-manager.lambdatest.com/x"');
    expect(html).toContain('src="evidence/home__network.jpg"');
  });

  it("says so plainly when nothing leaks", () => {
    expect(renderHtml({ before: scanReport([]) }, "/r")).toContain("No leaks found");
  });
});

describe("writeReport", () => {
  it("writes .leakproof/report.html and returns its path", () => {
    const dir = tempDir();
    const path = writeReport(dir, { before: scanReport([finding()]) });
    expect(path).toBe(join(dir, ".leakproof", "report.html"));
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("<!doctype html>");
  });
});
