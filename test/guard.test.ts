import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitState, restoreGitState } from "../src/git.js";
import { writeOwnFile } from "../src/guard.js";
import { tempDir } from "./helpers.js";

describe("writeOwnFile", () => {
  it("replaces a planted symlink instead of writing through it", () => {
    const dir = tempDir("lp-own-");
    const victim = join(dir, "victim.txt");
    writeFileSync(victim, "keep\n");
    mkdirSync(join(dir, ".leakproof"));
    symlinkSync(victim, join(dir, ".leakproof", "report.html"));
    writeOwnFile(join(dir, ".leakproof", "report.html"), "report\n");
    expect(readFileSync(victim, "utf8")).toBe("keep\n");
    expect(readFileSync(join(dir, ".leakproof", "report.html"), "utf8")).toBe("report\n");
  });

  it("refuses to write into a symlinked folder", () => {
    const dir = tempDir("lp-own-");
    mkdirSync(join(dir, "elsewhere"));
    mkdirSync(join(dir, ".leakproof"));
    symlinkSync(join(dir, "elsewhere"), join(dir, ".leakproof", "prompts"));
    expect(() => writeOwnFile(join(dir, ".leakproof", "prompts", "a.txt"), "x")).toThrow(/symlink/);
    expect(existsSync(join(dir, "elsewhere", "a.txt"))).toBe(false);
  });
});

describe("restoreGitState with symlinks", () => {
  it("removes a symlinked .git/info instead of writing through it", async () => {
    const repo = tempDir("lp-gs-");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "dev@example.com");
    git("config", "user.name", "Dev");
    writeFileSync(join(repo, "a.txt"), "a\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    const before = await gitState(repo);
    const elsewhere = tempDir("lp-else-");
    writeFileSync(join(elsewhere, "exclude"), "victim\n");
    execFileSync("rm", ["-rf", join(repo, ".git", "info")]);
    symlinkSync(elsewhere, join(repo, ".git", "info"));
    await restoreGitState(repo, before);
    expect(readFileSync(join(elsewhere, "exclude"), "utf8")).toBe("victim\n");
  });
});

describe("restoreGitState", () => {
  it("deletes git files the agent created, such as info/attributes", async () => {
    const repo = tempDir("lp-gs-");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "dev@example.com");
    git("config", "user.name", "Dev");
    writeFileSync(join(repo, "a.txt"), "a\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    const attributes = join(repo, ".git", "info", "attributes");
    const before = await gitState(repo);
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    writeFileSync(attributes, "*.js filter=evil\n");
    await restoreGitState(repo, before);
    expect(existsSync(attributes)).toBe(false);
  });
});
