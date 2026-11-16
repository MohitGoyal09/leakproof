import { describe, expect, it } from "vitest";
import { formatHeader, formatRow, formatSummary } from "../src/report/terminal.js";
import type { Finding, ScanReport } from "../src/types.js";

const finding: Finding = {
  id: "home:network", check: "network", flow: "home", assertion: "", offender: "/api/recommendations",
  evidence: ["GET /api/recommendations returned 500"], title: "Recommendations request fails", reason: "", summary: "",
};
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("terminal", () => {
  it("shows LEAK with the flow, the check label and the evidence", () => {
    const row = strip(formatRow({ unit: "home:network", status: "failed", finding }, 100));
    expect(row).toMatch(/^ {2}LEAK +home +Hidden server errors +GET \/api\/recommendations returned 500$/);
  });

  it("shows PASS and ERROR rows", () => {
    expect(strip(formatRow({ unit: "checkout:cookies", status: "passed" }, 100))).toContain("PASS");
    expect(strip(formatRow({ unit: "checkout:cookies", status: "error", message: "browser closed" }, 100))).toContain("ERROR");
  });

  it("never wraps: truncates to the terminal width", () => {
    const long = { ...finding, evidence: ["x".repeat(300)] };
    expect(strip(formatRow({ unit: "home:network", status: "failed", finding: long }, 80)).length).toBeLessThanOrEqual(80);
  });

  it("strips control characters from page-supplied text", () => {
    const evil = { ...finding, evidence: ["boom\x1b]0;pwned\x07\x1b[2J done\r\n"] };
    const row = formatRow({ unit: "home:network", status: "failed", finding: evil }, 100);
    expect(row).not.toMatch(/\x1b\]|\x07|\x1b\[2J|\r/);
    expect(strip(row)).toContain("boom]0;pwned[2J done");
    expect(formatHeader("http://x\x1b[2J", 1, 1)).not.toContain("\x1b[2J");
  });

  it("header names the url and the size of the scan", () => {
    expect(strip(formatHeader("http://localhost:3000", 6, 3))).toContain("6 checks across 3 flows");
  });

  it("header uses singular for one check and one flow", () => {
    expect(strip(formatHeader("http://x", 1, 1))).toContain("1 check across 1 flow");
  });

  it("summary counts leaks, errors and credits", () => {
    const report = { findings: [finding], errors: [], credits: 118.4, units: 6 } as unknown as ScanReport;
    const out = strip(formatSummary(report, 192_000, ".leakproof/findings.json"));
    expect(out).toContain("1 leak");
    expect(out).toContain("118 credits");
    expect(out).toContain("3m 12s");
  });
});
