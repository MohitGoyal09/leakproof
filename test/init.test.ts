import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { runInit } from "../src/init.js";
import { tempDir } from "./helpers.js";

describe("runInit", () => {
  it("writes a starter config that loads", () => {
    const dir = tempDir();
    const { configPath } = runInit(dir);
    expect(configPath).toBe(join(dir, "leakproof.yml"));
    const c = loadConfig(configPath, { APP_USER: "u", APP_PASSWORD: "p" });
    expect(c.flows.length).toBeGreaterThan(0);
    expect(c.flows.flatMap((f) => f.checks).sort()).toEqual(["console", "cookies", "env-leak", "network", "storage", "vitals"]);
  });

  it("adds .leakproof/ to .gitignore once", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    expect(runInit(dir).gitignoreUpdated).toBe(true);
    writeFileSync(join(dir, "leakproof.yml"), "");
    const text = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(text.match(/^\.leakproof\/$/gm)).toHaveLength(1);
    expect(text.startsWith("node_modules\n")).toBe(true);
  });

  it("creates .gitignore when missing", () => {
    const dir = tempDir();
    runInit(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".leakproof/\n");
  });

  it("refuses to overwrite an existing config", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "leakproof.yml"), "url: http://x\n");
    expect(() => runInit(dir)).toThrow(/already exists/);
    expect(readFileSync(join(dir, "leakproof.yml"), "utf8")).toBe("url: http://x\n");
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });
});
