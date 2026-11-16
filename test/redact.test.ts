import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildFixPrompt } from "../src/fixer.js";
import { redactSecrets } from "../src/redact.js";
import { scan } from "../src/scan.js";
import type { Config } from "../src/types.js";
import { tempDir, useFakeKane } from "./helpers.js";

let server: Server;
let url: string;
beforeEach(async () => {
  server = createServer((_q, s) => s.end("ok"));
  await new Promise<void>((r) => server.listen(0, () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => server.close());

const config = (): Config => ({
  ...loadConfig("examples/shop/leakproof.yml", { SHOP_USER: "demo", SHOP_PASS: "hunter2-secret" }),
  url, start: undefined, configDir: tempDir("lp-redact-"),
});

describe("redactSecrets", () => {
  it("masks every secret value of 3+ characters", () => {
    expect(redactSecrets("user demo pass hunter2-secret", ["hunter2-secret", "ab"])).toBe("user demo pass •••");
  });
});

describe("secrets never leave in Kane's own words", () => {
  it("findings.json and the raw run logs are masked", async () => {
    useFakeKane({ HttpOnly: { fixture: "fail-secret", exit: 1, stderr: "debug: typed hunter2-secret" } });
    const c = config();
    const report = await scan(c, { only: "cookies" });
    expect(JSON.stringify(report)).not.toContain("hunter2-secret");
    expect(readFileSync(join(c.configDir, ".leakproof", "findings.json"), "utf8")).not.toContain("hunter2-secret");
    const runs = join(c.configDir, ".leakproof", "runs");
    for (const f of readdirSync(runs)) expect(readFileSync(join(runs, f), "utf8")).not.toContain("hunter2-secret");
  });

  it("the fix prompt masks Kane's last result", () => {
    const c = config();
    const prompt = buildFixPrompt(
      { id: "checkout:cookies", check: "cookies", flow: "checkout", assertion: "a", evidence: [], title: "t", reason: "r", summary: "" },
      c.flows[2],
      { status: "failed", exitCode: 1, summary: "typed hunter2-secret", reason: "hunter2-secret", finalState: {} },
      ["hunter2-secret"],
    );
    expect(prompt).not.toContain("hunter2-secret");
  });
});
