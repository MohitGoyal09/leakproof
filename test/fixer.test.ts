import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildFixPrompt, fixAll } from "../src/fixer.js";
import type { Config, Finding } from "../src/types.js";
import { claudeCalls, kaneCalls, tempDir, useFakeClaude, useFakeKane } from "./helpers.js";

let server: Server;
let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

function writeRepo(url: string, checks: string): void {
  repo = tempDir("lp-repo-");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  writeFileSync(join(repo, ".gitignore"), ".leakproof/\n");
  writeFileSync(join(repo, "app.js"), "leaky\n");
  writeFileSync(
    join(repo, "leakproof.yml"),
    `url: ${url}\nenv: [SHOP_PASS]\nflows:\n  - name: checkout\n    checks: [${checks}]\n    steps:\n      - Sign in with password {{SHOP_PASS}}\n      - Open /checkout\n`,
  );
  git("add", "-A");
  git("commit", "-qm", "init");
}

const config = (): Config => loadConfig(join(repo, "leakproof.yml"), { SHOP_PASS: "demo123" });
const clean = () => git("status", "--porcelain");

beforeEach(async () => {
  server = createServer((_q, s) => s.end("ok"));
  await new Promise<void>((r) => server.listen(0, () => r()));
  writeRepo(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "cookies");
});
afterEach(() => server.close());

describe("fixAll", () => {
  it("refuses a dirty tree", async () => {
    writeFileSync(join(repo, "stray.txt"), "x");
    useFakeKane({});
    await expect(fixAll(config())).rejects.toThrow(/commit or stash/);
  });

  it("fixes on the first attempt, commits on a new branch, and re-scans", async () => {
    useFakeKane({ HttpOnly: [{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "pass", exit: 0 }] });
    useFakeClaude([{ write: { path: "app.js", content: "fixed\n" } }]);
    const report = await fixAll(config());
    expect(report.outcomes?.[0].fixed).toBe(true);
    expect(report.outcomes?.[0].attempts).toEqual([{ attempt: 1, files: ["app.js"], verdict: "fixed" }]);
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toMatch(/^leakproof\/fix-\d{8}-\d{6}$/);
    expect(git("log", "-1", "--pretty=%s")).toBe("fix: leakproof cookies in checkout");
    expect(git("log", "-1", "--pretty=%b")).not.toMatch(/Co-Authored-By/i);
    expect(report.after?.findings).toEqual([]);
    expect(readFileSync(join(repo, ".leakproof", "report.html"), "utf8")).toContain("FIXED");
  });

  it("retries with Kane's feedback, then gives up with a clean tree", async () => {
    useFakeKane({ HttpOnly: { fixture: "fail", exit: 1 } });
    const log = useFakeClaude([{ write: { path: "app.js", content: "try\n" } }]);
    const report = await fixAll(config());
    const o = report.outcomes![0];
    expect(o.fixed).toBe(false);
    expect(o.attempts.map((a) => a.verdict)).toEqual(["still-failing", "still-failing", "still-failing"]);
    expect(clean()).toBe("");
    const prompts = claudeCalls(log).map((c) => c.prompt);
    expect(prompts[0]).not.toContain("Your last attempt");
    expect(prompts[1]).toContain("Your last attempt did not fix it");
  });

  it("rejects an edit to leakproof.yml without calling Kane for it", async () => {
    const kane = useFakeKane({ HttpOnly: [{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "pass", exit: 0 }] });
    useFakeClaude([{ write: { path: "leakproof.yml", content: "flows: []\n" } }, { write: { path: "app.js", content: "fixed\n" } }]);
    const report = await fixAll(config());
    expect(report.outcomes![0].attempts.map((a) => a.verdict)).toEqual(["rejected", "fixed"]);
    expect(readFileSync(join(repo, "leakproof.yml"), "utf8")).toContain("checkout");
    expect(kaneCalls(kane)).toHaveLength(3);
  });

  it("rejects an edit to leakproof.yml even when git ignores it", async () => {
    writeFileSync(join(repo, ".gitignore"), ".leakproof/\nleakproof.yml\n");
    git("rm", "-q", "--cached", "leakproof.yml");
    git("add", "-A");
    git("commit", "-qm", "ignore config");
    useFakeKane({ HttpOnly: [{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "pass", exit: 0 }] });
    useFakeClaude([{ write: { path: "leakproof.yml", content: "url: http://x\nflows: []\n" } }, { write: { path: "app.js", content: "fixed\n" } }]);
    const original = readFileSync(join(repo, "leakproof.yml"), "utf8");
    const report = await fixAll(config());
    expect(report.outcomes![0].attempts.map((a) => a.verdict)).toEqual(["rejected", "fixed"]);
    expect(readFileSync(join(repo, "leakproof.yml"), "utf8")).toBe(original);
  });

  it("treats an agent crash or timeout as an error and moves to the next finding", async () => {
    server.close();
    server = createServer((_q, s) => s.end("ok"));
    await new Promise<void>((r) => server.listen(0, () => r()));
    writeRepo(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "cookies, storage");
    useFakeKane({
      HttpOnly: { fixture: "fail", exit: 1 },
      "localStorage key": [{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "pass", exit: 0 }],
    });
    useFakeClaude([{ exit: 1 }, { sleep: 5000 }, { write: { path: "app.js", content: "fixed\n" } }]);
    const report = await fixAll(config(), { maxAttempts: 2, agentTimeoutMs: 400 });
    expect(report.outcomes![0].attempts.map((a) => a.verdict)).toEqual(["error", "error"]);
    expect(report.outcomes![1].fixed).toBe(true);
    expect(git("log", "-1", "--pretty=%s")).toBe("fix: leakproof storage in checkout");
  });
});

describe("buildFixPrompt", () => {
  const finding: Finding = {
    id: "checkout:cookies", check: "cookies", flow: "checkout", assertion: "assert that no cookies are set without the HttpOnly flag.",
    offender: "session", evidence: ["Set-Cookie session without HttpOnly"], title: "Session cookie lacks HttpOnly",
    reason: "The sign-in sets a cookie without HttpOnly.", summary: "", suggestion: "Set httpOnly: true.",
  };

  it("contains the evidence and the rules, and never secret values", () => {
    const c = config();
    const prompt = buildFixPrompt(finding, c.flows[0]);
    expect(prompt).toContain("Session cookie lacks HttpOnly");
    expect(prompt).toContain("Set-Cookie session without HttpOnly");
    expect(prompt).toContain("Do not edit leakproof.yml");
    expect(prompt).toContain("{{SHOP_PASS}}");
    expect(prompt).not.toContain("demo123");
  });
});
