import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertionFor } from "../src/checks.js";
import { dedupe, deriveEvidence, readEvidencePack, toFinding, type EvidencePack } from "../src/findings.js";
import { parseNdjson } from "../src/kane.js";
import type { Finding, RunUnit } from "../src/types.js";
import { tempDir } from "./helpers.js";

const pack = (u: string): EvidencePack => JSON.parse(readFileSync(`test/fixtures/evidence/${u}.json`, "utf8"));
const ctx = { appHost: "localhost:3000", slowMs: 1000 };
const unit: RunUnit = {
  id: "checkout:cookies",
  flow: "checkout",
  check: "cookies",
  objective: `1. Open the page. In this same step, ${assertionFor("cookies", { appHost: "localhost:3000", vitals: { slowMs: 1000 } })}`,
};
const result = (n: string, code: number) => parseNdjson(readFileSync(`test/fixtures/ndjson/${n}.ndjson`, "utf8"), code);

describe("deriveEvidence", () => {
  it("names the failing endpoint for network", () => {
    const e = deriveEvidence("network", pack("home__network"), ctx);
    expect(e.offender).toBe("/api/recommendations");
    expect(e.evidence).toContain("GET /api/recommendations returned 500");
  });

  it("names slow requests with their duration for vitals", () => {
    const e = deriveEvidence("vitals", pack("home__vitals"), ctx);
    expect(e.offender).toBe("/api/hero");
    expect(e.evidence).toContain("GET / took 1526 ms (document)");
    expect(e.evidence.some((l) => l.startsWith("GET /api/hero took 300"))).toBe(true);
  });

  it("names the leaked host for env-leak", () => {
    const e = deriveEvidence("env-leak", pack("checkout__env-leak"), ctx);
    expect(e.offender).toBe("staging.localhost:3000");
    expect(e.evidence).toEqual(["POST http://staging.localhost:3000/api/collect"]);
  });

  it("names the console error and ignores resource-load noise", () => {
    const e = deriveEvidence("console", pack("add-to-cart__console"), ctx);
    expect(e.offender).toBe("Cannot read properties of undefined (reading 'track')");
    expect(e.evidence.join("\n")).not.toContain("Failed to load resource");
  });

  it("returns no raw evidence for cookies (Kane's verdict carries it)", () => {
    expect(deriveEvidence("cookies", pack("checkout__cookies"), ctx).evidence).toEqual([]);
  });
});

describe("toFinding", () => {
  it("passed result gives no finding", () => {
    expect(toFinding(unit, result("pass", 0))).toBeNull();
  });

  it("error result gives no finding", () => {
    expect(toFinding(unit, result("infra", 1))).toBeNull();
  });

  it("failed result maps Kane's verdict and the assertion", () => {
    const f = toFinding(unit, result("fail", 1))!;
    expect(f.id).toBe("checkout:cookies");
    expect(f.title).toBe("Authentication cookie lacks HttpOnly protection");
    expect(f.reason).toContain("HttpOnly");
    expect(f.suggestion).toBeTruthy();
    expect(f.assertion).toContain("no cookies are set without the HttpOnly flag");
    expect(f.testUrl).toMatch(/^https:\/\/test-manager/);
  });

  it("adds derived evidence and screenshot from the pack", () => {
    const f = toFinding({ ...unit, id: "home:network", flow: "home", check: "network" }, result("fail", 1), { ...pack("home__network"), screenshot: "/x/shot.jpg" }, ctx)!;
    expect(f.offender).toBe("/api/recommendations");
    expect(f.screenshot).toBe("/x/shot.jpg");
  });
});

describe("readEvidencePack", () => {
  it("reads HAR, console and the failing step screenshot from a .evidence zip", () => {
    const session = tempDir("lp-session-");
    const src = tempDir("lp-pack-");
    const test = join(src, "tests", "1-open-x");
    mkdirSync(join(test, "logs"), { recursive: true });
    mkdirSync(join(test, "steps", "3-0-3"), { recursive: true });
    writeFileSync(join(test, "logs", "0-network.har"), JSON.stringify({ log: { entries: pack("home__network").har } }));
    writeFileSync(join(test, "logs", "0-console.ndjson"), pack("home__network").console.map((c) => JSON.stringify(c)).join("\n"));
    writeFileSync(join(test, "steps", "3-0-3", "screenshot.jpg"), "jpg-bytes");
    writeFileSync(join(src, "failure.yaml"), "failures:\n  - test: 1-open-x\n    path: tests/1-open-x/steps/3-0-3/failure.yaml\n");
    mkdirSync(join(session, "evidence"));
    execFileSync("zip", ["-qr", join(session, "evidence", "a.evidence"), "."], { cwd: src });

    const out = tempDir("lp-out-");
    const p = readEvidencePack(session, out, "home:network");
    expect(p.har).toHaveLength(pack("home__network").har.length);
    expect(p.console.length).toBeGreaterThan(0);
    expect(p.screenshot).toBe(join(out, "home__network.jpg"));
    expect(existsSync(p.screenshot!)).toBe(true);
  });

  it("returns an empty pack when there is no evidence", () => {
    expect(readEvidencePack(tempDir(), tempDir(), "x:y")).toEqual({ har: [], console: [] });
  });
});

describe("dedupe", () => {
  const f = (over: Partial<Finding>): Finding => ({
    id: "a:env-leak", check: "env-leak", flow: "a", assertion: "", evidence: [], title: "", reason: "", summary: "", ...over,
  });

  it("merges the same offender across flows", () => {
    const out = dedupe([f({ offender: "staging.localhost:3000" }), f({ id: "b:env-leak", flow: "b", offender: "staging.localhost:3000" })]);
    expect(out).toHaveLength(1);
  });

  it("keeps findings without an offender per flow", () => {
    expect(dedupe([f({ id: "a:storage", check: "storage" }), f({ id: "b:storage", check: "storage", flow: "b" })])).toHaveLength(2);
  });
});
