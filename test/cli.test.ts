import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { saveLessons } from "../src/lessons.js";
import { kaneCalls, tempDir, useFakeKane } from "./helpers.js";

let server: Server;
let dir: string;
let out: string[];

beforeEach(async () => {
  server = createServer((_q, s) => s.end("ok"));
  await new Promise<void>((r) => server.listen(0, () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = tempDir("lp-cli-");
  const yml = readFileSync("examples/shop/leakproof.yml", "utf8").replace("http://localhost:3000", url).replace(/^start:.*\n/m, "");
  writeFileSync(join(dir, "leakproof.yml"), yml);
  process.env.SHOP_USER = "demo";
  process.env.SHOP_PASS = "demo123";
  out = [];
});
afterEach(() => server.close());

const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), width: 100 };

describe("cli main", () => {
  it("scan exits 1 when leaks are found and prints LEAK rows", async () => {
    useFakeKane({ "status of 500": { fixture: "fail", exit: 1 } });
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml")], io);
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("LEAK");
  });

  it("scan says when a leak Kane proved fixed in an earlier run is back", async () => {
    saveLessons(dir, [{ id: "home:network", check: "network", flow: "home", outcome: "passed", files: ["app/api/route.ts"], commit: "abc1234def5678", at: "2026-11-21T10:00:00.000Z" }]);
    useFakeKane({ "status of 500": { fixture: "fail", exit: 1 } });
    await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml")], io);
    expect(out.join("\n")).toMatch(/came back.*home network.*abc1234/);
  });

  it("scan exits 0 when clean", async () => {
    useFakeKane({});
    expect(await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml")], io)).toBe(0);
  });

  it("a config error prints one line and exits 2", async () => {
    delete process.env.SHOP_PASS;
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml")], io);
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("SHOP_PASS");
    expect(out.join("\n")).not.toMatch(/at .*\.ts:\d+/);
  });

  it("checks the Kane login before spending credits", async () => {
    const kane = useFakeKane({ whoami: { exit: 1 } });
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml")], io);
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("kane-cli login");
    expect(kaneCalls(kane).map((c) => c.argv[0])).toEqual(["whoami"]);
  });

  it("missing kane prints the install hint and exits 2", async () => {
    process.env.LEAKPROOF_KANE_BIN = "/nonexistent/kane-cli";
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml"), "--only", "cookies"], io);
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("npm install -g @testmuai/kane-cli");
  });

  it("stops when --flow matches no checks, instead of reporting 0 leaks", async () => {
    useFakeKane({});
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml"), "--flow", "no-such-flow"], io);
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("No checks match");
  });

  it("rejects an unknown --only check", async () => {
    useFakeKane({});
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml"), "--only", "xss"], io);
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("cookies, storage, network, console, env-leak, vitals");
  });
});


describe("cli fix", () => {
  it("fixes a leak, proves it, and prints the before → after line", async () => {
    const { execFileSync } = await import("node:child_process");
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    writeFileSync(join(dir, ".gitignore"), ".leakproof/\n");
    writeFileSync(join(dir, "app.js"), "leaky\n");
    const yml = readFileSync(join(dir, "leakproof.yml"), "utf8").replace(/checks: \[cookies, storage, env-leak\]/, "checks: [cookies]")
      .replace(/  - name: home[\s\S]*?(?=  - name: checkout)/, "");
    writeFileSync(join(dir, "leakproof.yml"), yml);
    g("init", "-q", "-b", "main"); g("config", "user.email", "d@e.com"); g("config", "user.name", "D"); g("add", "-A"); g("commit", "-qm", "init");
    useFakeKane({ HttpOnly: [{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "pass", exit: 0 }] });
    const { useFakeClaude } = await import("./helpers.js");
    useFakeClaude([{ write: { path: "app.js", content: "fixed\n" } }]);
    const code = await main(["node", "leakproof", "fix", "--config", join(dir, "leakproof.yml")], io);
    const text = out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(code).toBe(0);
    expect(text).toContain("FIXED");
    expect(text).toMatch(/1 → 0 leaks/);
    expect(text).toContain("report.html");
  });

  it("scan also writes report.html", async () => {
    useFakeKane({});
    await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml"), "--only", "cookies"], io);
    expect(out.join("\n")).toContain("report.html");
    expect(readFileSync(join(dir, ".leakproof", "report.html"), "utf8")).toContain("No leaks found");
  });
});
