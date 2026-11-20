import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePorcelain, revertAll } from "../src/git.js";
import { tempDir } from "./helpers.js";

describe("parsePorcelain", () => {
  it("keeps the first character of the first path", () => {
    expect(parsePorcelain(" M app.js\0?? new/file.ts\0")).toEqual(["app.js", "new/file.ts"]);
  });

  it("reports both paths of a rename, and only the new path of a copy", () => {
    expect(parsePorcelain("R  b.ts\0a.ts\0 M c.ts\0")).toEqual(["b.ts", "a.ts", "c.ts"]);
    expect(parsePorcelain("C  d.ts\0a.ts\0")).toEqual(["d.ts"]);
  });

  it("ignores Leakproof's own output folder, and only that one", () => {
    expect(parsePorcelain("?? .leakproof/report.html\0?? sub/.leakproof/x\0 M y.ts\0")).toEqual(["sub/.leakproof/x", "y.ts"]);
    expect(parsePorcelain("?? sub/.leakproof/x\0?? .leakproof/y\0", "sub/.leakproof")).toEqual([".leakproof/y"]);
  });

  it("keeps paths with spaces intact", () => {
    expect(parsePorcelain("?? my file.ts\0")).toEqual(["my file.ts"]);
  });
});

describe("revertAll", () => {
  it("also throws away staged edits and staged new files", async () => {
    const repo = tempDir("lp-git-");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "dev@example.com");
    git("config", "user.name", "Dev");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    writeFileSync(join(repo, "a.txt"), "two\n");
    writeFileSync(join(repo, "new.txt"), "x\n");
    git("add", "-A");
    await revertAll(repo);
    expect(git("status", "--porcelain")).toBe("");
    expect(existsSync(join(repo, "new.txt"))).toBe(false);
  });
});
