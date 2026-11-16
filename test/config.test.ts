import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const SHOP = "examples/shop/leakproof.yml";
const ENV = { SHOP_USER: "d", SHOP_PASS: "p" };

function tmpConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-config-"));
  const path = join(dir, "leakproof.yml");
  writeFileSync(path, yaml);
  return path;
}

describe("loadConfig", () => {
  it("loads the shop example", () => {
    const c = loadConfig(SHOP, ENV);
    expect(c.flows).toHaveLength(3);
    expect(c.flows[2].checks).toEqual(["cookies", "storage", "env-leak"]);
    expect(c.vitals).toEqual({ slowMs: 1000 });
    expect(c.url).toBe("http://localhost:3000");
    expect(c.secrets).toEqual(ENV);
  });

  it("normalises string steps", () => {
    const c = loadConfig(SHOP, ENV);
    expect(c.flows[0].steps[0]).toEqual({ do: "Open the home page and wait for the product list to appear" });
  });

  it("defaults vitals.slowMs to 1000 and env to []", () => {
    const c = loadConfig(tmpConfig("url: http://localhost:4000\nflows:\n  - name: a\n    checks: [network]\n    steps: [Open the page]\n"), {});
    expect(c.vitals).toEqual({ slowMs: 1000 });
    expect(c.env).toEqual([]);
  });

  it("rejects unknown check", () => {
    const p = tmpConfig("url: http://localhost:4000\nflows:\n  - name: a\n    checks: [xss]\n    steps: [Open]\n");
    expect(() => loadConfig(p, {})).toThrow(ConfigError);
    expect(() => loadConfig(p, {})).toThrow(/flows\[0\]\.checks\[0\]/);
  });

  it("fails fast on missing env var", () => {
    expect(() => loadConfig(SHOP, { SHOP_USER: "d" })).toThrow(ConfigError);
    expect(() => loadConfig(SHOP, { SHOP_USER: "d" })).toThrow(/SHOP_PASS/);
  });

  it("rejects non-http url", () => {
    const p = tmpConfig("url: ftp://x\nflows:\n  - name: a\n    checks: [network]\n    steps: [Open]\n");
    expect(() => loadConfig(p, {})).toThrow(/url/);
  });

  it("rejects a missing file with the path in the message", () => {
    expect(() => loadConfig("nope/leakproof.yml", {})).toThrow(/nope\/leakproof\.yml/);
  });

  it("rejects a flow with no steps", () => {
    const p = tmpConfig("url: http://localhost:4000\nflows:\n  - name: a\n    checks: [network]\n    steps: []\n");
    expect(() => loadConfig(p, {})).toThrow(/flows\[0\]\.steps/);
  });
});
