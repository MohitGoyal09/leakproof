import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertionFor } from "../src/checks.js";
import { dedupe, deriveEvidence, guardedPaths, readEvidencePack, requestsKept, requestStillSucceeds, silencesConsole, toFinding, type EvidencePack } from "../src/findings.js";
import { parseNdjson } from "../src/kane.js";
import type { Finding, RunUnit } from "../src/types.js";
import { tempDir } from "./helpers.js";

const pack = (u: string): EvidencePack => JSON.parse(readFileSync(`test/fixtures/evidence/${u}.json`, "utf8"));
const ctx = { appHostname: "localhost", slowMs: 1000 };
const unit: RunUnit = {
  id: "checkout:cookies",
  flow: "checkout",
  check: "cookies",
  objective: `1. Open the page. In this same step, ${assertionFor("cookies", { appHostname: "localhost", vitals: { slowMs: 1000 } })}`,
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

  it("a call to the app's own API on another port is not an env leak", () => {
    const own = { har: [{ request: { method: "GET", url: "http://localhost:3001/users" }, response: { status: 200 }, time: 12 }], console: [] } as unknown as EvidencePack;
    expect(deriveEvidence("env-leak", own, ctx).evidence).toEqual([]);
  });

  it("a staging host on the same machine is still a leak", () => {
    expect(deriveEvidence("env-leak", pack("checkout__env-leak"), ctx).evidence).toEqual(["POST http://staging.localhost:3000/api/collect"]);
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

  it("keeps a title short: first line of a long console error, cut at 90 characters", () => {
    const consoleUnit = { ...unit, id: "pay:console", check: "console" as const };
    const long = "Warning: Function components cannot be given refs. Attempts to access this ref will fail. Did you mean to use React.forwardRef()?\n    at NumberFormatCustom (http://localhost:3000/src/components/TransactionCreateStepTwo.tsx:36:10)";
    const pack = { har: [], console: [{ level: "error", text: long }] } as unknown as EvidencePack;
    const f = toFinding(consoleUnit, { ...result("fail", 1), verdict: undefined }, pack, ctx)!;
    expect(f.title.length).toBeLessThanOrEqual(90);
    expect(f.title).toMatch(/^Console errors: Warning: Function components cannot be given refs/);
    expect(f.title).not.toContain("\n");
    expect(f.title.endsWith("…")).toBe(true);
    expect(f.evidence[0]).toBe(long);
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

  it("uses an evidence-based title when Kane did not confirm its verdict", () => {
    const r = result("fail", 1);
    const unconfirmed = { ...r, verdict: { ...r.verdict, confirmed: false, bugTitle: "Unsubstantiated page-load timing assertion", rootCause: "No timings supplied." } };
    const f = toFinding({ ...unit, id: "home:vitals", flow: "home", check: "vitals" }, unconfirmed, pack("home__vitals"), ctx)!;
    expect(f.title).toBe("Slow requests: /api/hero");
    expect(f.reason).toContain("GET /api/hero took");
    expect(f.reason).not.toContain("No timings supplied");
  });

  it("uses a plain title when Kane doubts its verdict and there is no raw evidence", () => {
    const r = result("fail", 1);
    const unconfirmed = { ...r, verdict: { ...r.verdict, confirmed: false, bugTitle: "Cookie checkpoint outcome conflicts with recorded assertion" } };
    const f = toFinding(unit, unconfirmed)!;
    expect(f.title).toBe("Cookie flags check failed in the checkout flow");
    expect(f.reason).toContain("no cookies are set without the HttpOnly flag");
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

describe("requestStillSucceeds", () => {
  const har = (...entries: [string, number][]) =>
    ({ har: entries.map(([url, status]) => ({ request: { method: "GET", url }, response: { status }, time: 10 })), console: [] }) as unknown as EvidencePack;

  it("is true when the request still happens and succeeds", () => {
    expect(requestStillSucceeds(har(["http://localhost:3000/api/recommendations", 200]), "/api/recommendations")).toBe(true);
  });
  it("is false when the request still fails", () => {
    expect(requestStillSucceeds(har(["http://localhost:3000/api/recommendations", 500]), "/api/recommendations")).toBe(false);
  });
  it("is false when the request no longer happens", () => {
    expect(requestStillSucceeds(har(["http://localhost:3000/", 200]), "/api/recommendations")).toBe(false);
  });
  it("is undefined when the run left no network log", () => {
    expect(requestStillSucceeds(har(), "/api/recommendations")).toBeUndefined();
  });
  it("matches on the path, so a changed query still counts as the same request", () => {
    expect(requestStillSucceeds(har(["http://localhost:3000/api/x?id=2", 204]), "/api/x?id=1")).toBe(true);
  });
});

describe("guardedPaths and requestsKept", () => {
  const finding = (check: "network" | "vitals" | "console", evidence: string[]) =>
    ({ id: `f:${check}`, check, flow: "f", assertion: "", evidence, title: "", reason: "", summary: "" }) as unknown as Parameters<typeof guardedPaths>[0];

  it("guards every failing request of a network finding", () => {
    expect(guardedPaths(finding("network", ["GET /api/a returned 500", "POST /api/b?x=1 returned 502"]))).toEqual(["/api/a", "/api/b?x=1"]);
  });
  it("guards every slow request of a vitals finding", () => {
    expect(guardedPaths(finding("vitals", ["GET /api/hero took 3020 ms (fetch)", "GET / took 1528 ms (document)"]))).toEqual(["/api/hero", "/"]);
  });
  it("guards nothing for other checks", () => {
    expect(guardedPaths(finding("console", ["TypeError: x"]))).toEqual([]);
  });
  it("cannot judge a run with no session folder, and never reads one from the working directory", () => {
    expect(requestsKept(finding("network", ["GET /api/a returned 500"]), undefined, tempDir())).toBeUndefined();
    expect(requestsKept(finding("network", ["GET /api/a returned 500"]), "", tempDir())).toBeUndefined();
  });
});

describe("silencesConsole", () => {
  const diff = (...lines: string[]) => ["diff --git a/app.js b/app.js", "--- a/app.js", "+++ b/app.js", "@@ -1,3 +1,3 @@", ...lines].join("\n");

  it("accepts a fix of the cause", () => {
    expect(silencesConsole(diff('-  window.analytics.track("add");', '+  window.analytics?.track("add");'))).toBeUndefined();
  });

  it("rejects a removed console.error call", () => {
    expect(silencesConsole(diff('-  console.error("cart failed", err);', "+  // nothing"))).toMatch(/removes a console\.error call/);
  });

  it("accepts a console.error call that only moves", () => {
    expect(silencesConsole(diff('-  console.error("cart failed", err);', '+    console.error("cart failed", err);'))).toBeUndefined();
  });

  it("rejects an override of a console method or of console itself", () => {
    expect(silencesConsole(diff("+console.error = () => {};"))).toMatch(/replaces console/);
    expect(silencesConsole(diff('+console["error"] = function () {};'))).toMatch(/replaces console/);
    expect(silencesConsole(diff("+Object.defineProperty(window.console, 'error', { value() {} });"))).toMatch(/replaces console/);
    expect(silencesConsole(diff("+globalThis.console = { ...console, error() {} };"))).toMatch(/replaces console/);
  });

  it("does not read a comparison as an override", () => {
    expect(silencesConsole(diff("+if (console.error === undefined) throw new Error('no console');"))).toBeUndefined();
  });

  it("rejects a new global error handler", () => {
    expect(silencesConsole(diff("+window.onerror = () => true;"))).toMatch(/global error handler/);
    expect(silencesConsole(diff('+window.addEventListener("unhandledrejection", (e) => e.preventDefault());'))).toMatch(/global error handler/);
  });

  it("rejects an empty catch that swallows the error", () => {
    expect(silencesConsole(diff("+try { track(); } catch {}"))).toMatch(/empty catch/);
    expect(silencesConsole(diff("+try { track(); } catch (e) { }"))).toMatch(/empty catch/);
    expect(silencesConsole(diff("+load().catch(() => {});"))).toMatch(/empty catch/);
    expect(silencesConsole(diff("+load().catch(() => undefined);"))).toMatch(/empty catch/);
  });

  it("ignores an empty catch that was already there", () => {
    expect(silencesConsole(diff('   fetch("/api/collect").catch(() => {});', "-  bad();", "+  good();"))).toBeUndefined();
    expect(silencesConsole(diff('-fetch("http://staging/collect").catch(() => {});', '+fetch("/api/collect").catch(() => {});'))).toBeUndefined();
  });

  it("rejects suppressHydrationWarning", () => {
    expect(silencesConsole(diff("+  <time suppressHydrationWarning>{now}</time>"))).toMatch(/suppressHydrationWarning/);
  });

  it("does not count the file header as an added or removed line", () => {
    expect(silencesConsole("diff --git a/x b/x\n--- a/console.error = x\n+++ b/console.error = x\n@@ -1 +1 @@\n")).toBeUndefined();
  });

  it("counts content lines that start like a header, in a hunk and in a new file", () => {
    expect(silencesConsole(diff('--- console.error("x");', "+ok"))).toMatch(/removes a console\.error call/);
    expect(silencesConsole("+++globalThis.x, console.error = () => {}")).toMatch(/replaces console/);
  });

  it("rejects compound assignments, shadows and other ways to replace console", () => {
    for (const line of ["console.error ||= noop;", "console.error ??= noop;", "const console = { log() {} };", "console = quiet;", "global.console = quiet;", "Reflect.set(console, 'error', noop);", "Object.defineProperties(console, { error: { value: noop } });"])
      expect(silencesConsole(diff(`+${line}`)), line).toMatch(/replaces console/);
  });

  it("rejects empty catches with a comment, a function or a constant", () => {
    for (const line of ["try { a(); } catch (e) { /* ignore */ }", "a().catch(function () {});", "a().catch(() => false);", "a().catch(() => []);", "a().catch(() => ({}));"])
      expect(silencesConsole(diff(`+${line}`)), line).toMatch(/empty catch/);
  });

  it("counts each match, not each line", () => {
    expect(silencesConsole(diff("-a().catch(() => {});", "+a().catch(() => {}); b().catch(() => {});"))).toMatch(/empty catch/);
  });

  it("does not let a commented-out call make up for a removed one", () => {
    expect(silencesConsole(diff('-  console.error("x");', '+  // console.error("x");'))).toMatch(/removes a console\.error call/);
  });

  it("accepts error handlers on an element and a console field on another object", () => {
    for (const line of ["img.onerror = () => (img.src = fallback);", 'el.addEventListener("error", retry);', "foo.console.x = 1;"])
      expect(silencesConsole(diff(`+${line}`)), line).toBeUndefined();
  });

  it("stays fast on a very long line", () => {
    const start = Date.now();
    silencesConsole(`+${"console[".repeat(100000)}\n+${"catch(".repeat(100000)}`);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
