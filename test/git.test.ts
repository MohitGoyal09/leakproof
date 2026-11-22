import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffText, isAncestor, parsePorcelain, revertAll, untrackedFiles } from "../src/git.js";
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

describe("diffText and isAncestor", () => {
  const repo = () => {
    const dir = tempDir("lp-git-");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "dev@example.com");
    git("config", "user.name", "Dev");
    writeFileSync(join(dir, "a.js"), "one\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    return { dir, git };
  };

  it("reads file names literally, so a name with pathspec magic cannot break or widen the diff", async () => {
    const { dir } = repo();
    writeFileSync(join(dir, "a.js"), "two\n");
    writeFileSync(join(dir, ":(top)x"), "new\n");
    const diff = await diffText(dir, [":(bogus)x", ":(top)x", "a.js"]);
    expect(diff).toContain("+two");
  });

  it("shows text lines even when .gitattributes marks the file as binary", async () => {
    const { dir } = repo();
    writeFileSync(join(dir, ".gitattributes"), "*.js -diff\n");
    writeFileSync(join(dir, "a.js"), "two\n");
    expect(await diffText(dir, ["a.js"])).toContain("+two");
  });

  it("lists new files, including a nested repository, without naming them on the command line", async () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, "b.js"), "new\n");
    git("init", "-q", "sub");
    writeFileSync(join(dir, "sub", "q.js"), "x\n");
    expect((await untrackedFiles(dir)).sort()).toEqual(["b.js", "sub/"]);
  });

  it("says whether a commit is in the current branch's history", async () => {
    const { dir, git } = repo();
    const first = git("rev-parse", "HEAD");
    git("checkout", "-qb", "side");
    writeFileSync(join(dir, "a.js"), "side\n");
    git("commit", "-qam", "side");
    const side = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    expect(await isAncestor(dir, first)).toBe(true);
    expect(await isAncestor(dir, side)).toBe(false);
    expect(await isAncestor(dir, "abc1234def5678")).toBe(false);
    expect(await isAncestor(tempDir("lp-nogit-"), first)).toBe(false);
  });
});
