import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

// The run scripts wipe and re-create a scratch folder. A folder the user points them at must never be wiped
// unless the script created it.
describe.each([
  ["scripts/real-world.sh", "LEAKPROOF_RWA_DIR"],
  ["scripts/demo.sh", "LEAKPROOF_DEMO_DIR"],
])("%s", (script, envName) => {
  it("refuses to delete a folder it did not create", () => {
    const dir = tempDir("lp-keep-");
    writeFileSync(join(dir, "precious.txt"), "keep me\n");
    const res = spawnSync("bash", [script, "scan"], { env: { ...process.env, [envName]: dir }, encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/Refusing to delete/);
    expect(existsSync(join(dir, "precious.txt"))).toBe(true);
  });
});
