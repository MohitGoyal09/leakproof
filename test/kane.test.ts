import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KaneNotFoundError, parseNdjson, runKane } from "../src/kane.js";
import type { RunUnit } from "../src/types.js";
import { kaneCalls, tempDir, useFakeKane } from "./helpers.js";

const fixture = (n: string) => readFileSync(`test/fixtures/ndjson/${n}.ndjson`, "utf8");
const unit = (objective: string): RunUnit => ({ id: "checkout:cookies", flow: "checkout", check: "cookies", objective });
const opts = () => ({ url: "http://localhost:3000", secrets: { SHOP_PASS: "hunter2-secret" }, timeoutS: 30, outDir: tempDir() });

afterEach(() => {
  delete process.env.LEAKPROOF_KANE_BIN;
});

describe("parseNdjson", () => {
  it("parses a passing run", () => {
    const r = parseNdjson(fixture("pass"), 0);
    expect(r.status).toBe("passed");
    expect(r.runDir).toMatch(/runs\/0$/);
    expect(r.sessionDir).not.toMatch(/runs\/0$/);
  });

  it("parses a failed run with Kane's verdict", () => {
    const r = parseNdjson(fixture("fail"), 1);
    expect(r.status).toBe("failed");
    expect(r.reasonCode).toBe("assertion_error.confirmed_product_bug");
    expect(r.verdict?.bugTitle).toBe("Authentication cookie lacks HttpOnly protection");
    expect(r.reason).toContain("HttpOnly");
    expect(r.credits).toBeGreaterThan(0);
  });

  it("treats an infra failure with exit 1 as an error, not a finding", () => {
    expect(parseNdjson(fixture("infra"), 1).status).toBe("error");
  });

  it("missing run_end is an error", () => {
    const r = parseNdjson(fixture("no-run-end"), 1);
    expect(r.status).toBe("error");
    expect(r.summary).toContain("run_end");
  });

  it("exit 3 without run_end is a timeout", () => {
    expect(parseNdjson("", 3).status).toBe("timeout");
  });
});

describe("runKane", () => {
  it("returns the parsed result and saves raw output", async () => {
    useFakeKane({ HttpOnly: { fixture: "fail", exit: 1 } });
    const o = opts();
    const r = await runKane(unit("assert HttpOnly"), o);
    expect(r.status).toBe("failed");
    expect(existsSync(join(o.outDir, "checkout__cookies.ndjson"))).toBe(true);
  });

  it("retries an error once then reports error", async () => {
    const log = useFakeKane({ HttpOnly: { fixture: "infra", exit: 1 } });
    const r = await runKane(unit("assert HttpOnly"), opts());
    expect(r.status).toBe("error");
    expect(kaneCalls(log)).toHaveLength(2);
  });

  it("retries an error once and keeps a pass", async () => {
    const log = useFakeKane({ HttpOnly: [{ fixture: "infra", exit: 1 }, { fixture: "pass", exit: 0 }] });
    const r = await runKane(unit("assert HttpOnly"), opts());
    expect(r.status).toBe("passed");
    expect(kaneCalls(log)).toHaveLength(2);
  });

  it("does not retry a real failure", async () => {
    const log = useFakeKane({ HttpOnly: { fixture: "fail", exit: 1 } });
    await runKane(unit("assert HttpOnly"), opts());
    expect(kaneCalls(log)).toHaveLength(1);
  });

  it("passes secrets only via a variables file that is deleted afterwards", async () => {
    const log = useFakeKane({ HttpOnly: { fixture: "pass", exit: 0 } }, "hunter2-secret");
    await runKane(unit("sign in with {{SHOP_PASS}} then assert HttpOnly"), opts());
    const [call] = kaneCalls(log);
    expect(call.varsHadSecret).toBe(true);
    expect(call.argv.join(" ")).not.toContain("hunter2-secret");
    const varsPath = call.argv[call.argv.indexOf("--variables-file") + 1];
    expect(existsSync(varsPath)).toBe(false);
  });

  it("calls kane with the agent contract flags", async () => {
    const log = useFakeKane({ HttpOnly: { fixture: "pass", exit: 0 } });
    await runKane(unit("assert HttpOnly"), opts());
    const { argv } = kaneCalls(log)[0];
    expect(argv.slice(0, 2)).toEqual(["run", "assert HttpOnly"]);
    expect(argv).toEqual(expect.arrayContaining(["--url", "http://localhost:3000", "--agent", "--headless", "--timeout", "30"]));
  });

  it("explains how to install kane when it is missing", async () => {
    process.env.LEAKPROOF_KANE_BIN = "/nonexistent/kane-cli";
    await expect(runKane(unit("x"), opts())).rejects.toThrow(KaneNotFoundError);
    await expect(runKane(unit("x"), opts())).rejects.toThrow(/npm install -g @testmuai\/kane-cli/);
  });
});
