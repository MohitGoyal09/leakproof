import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { tempDir, useFakeKane } from "./helpers.js";

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

  it("missing kane prints the install hint and exits 2", async () => {
    process.env.LEAKPROOF_KANE_BIN = "/nonexistent/kane-cli";
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml"), "--only", "cookies"], io);
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("npm install -g @testmuai/kane-cli");
  });

  it("rejects an unknown --only check", async () => {
    useFakeKane({});
    const code = await main(["node", "leakproof", "scan", "--config", join(dir, "leakproof.yml"), "--only", "xss"], io);
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("cookies, storage, network, console, env-leak, vitals");
  });
});

