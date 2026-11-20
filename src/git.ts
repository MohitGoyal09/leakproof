import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

const OUTPUT_DIR = ".leakproof";
// The agent can write files under .git, so never let git run hooks or an fsmonitor on Leakproof's behalf.
const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

async function git(cwd: string, args: string[], raw = false): Promise<string> {
  const res = await execa("git", [...SAFE, ...args], { cwd, reject: false, stripFinalNewline: !raw });
  if (res.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${String(res.stderr || res.stdout).trim()}`);
  return raw ? String(res.stdout) : String(res.stdout).trim();
}

export async function repoRoot(dir: string): Promise<string> {
  return git(dir, ["rev-parse", "--show-toplevel"]);
}

/** Parse `git status --porcelain -z`: "XY path\0", with an extra "orig\0" after renames and copies. */
export function parsePorcelain(out: string, outputDir = OUTPUT_DIR): string[] {
  const parts = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    // A rename also removes the original path, so report it too (renaming package.json away is an edit to it).
    if (/[RC]/.test(entry.slice(0, 2))) {
      i++;
      if (entry[0] === "R" && parts[i]) paths.push(parts[i]);
    }
  }
  return paths.filter((path) => path !== outputDir && !path.startsWith(`${outputDir}/`));
}

/**
 * Files changed, added or untracked (not ignored) relative to the repo root, excluding Leakproof's own output.
 * `outputDir` is that output folder relative to the root; only that exact folder is excluded.
 */
export async function changedFiles(root: string, outputDir = OUTPUT_DIR): Promise<string[]> {
  return parsePorcelain(await git(root, ["status", "--porcelain", "-z", "--untracked-files=all"], true), outputDir);
}

export async function isClean(root: string, outputDir = OUTPUT_DIR): Promise<boolean> {
  return (await changedFiles(root, outputDir)).length === 0;
}

/** Throw away every uncommitted change, staged or not, keeping Leakproof's output folder. */
export async function revertAll(root: string, outputDir = OUTPUT_DIR): Promise<void> {
  await git(root, ["reset", "-q", "--hard"]);
  await git(root, ["clean", "-fd", "-e", `/${outputDir}/`]);
}

/** Ignored files, relative to the root. Git lists them; callers decide which to watch. */
export async function ignoredFiles(root: string): Promise<string[]> {
  return (await git(root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"], true)).split("\0").filter(Boolean);
}

export async function createBranch(root: string, name: string): Promise<void> {
  await git(root, ["checkout", "-q", "-b", name]);
}

/** Commit `only` (the files that were checked), or every change when it is not given. */
export async function commitAll(root: string, message: string, outputDir = OUTPUT_DIR, only?: readonly string[]): Promise<void> {
  const files = only ?? (await changedFiles(root, outputDir));
  await git(root, ["add", "--", ...files]);
  await git(root, ["commit", "-q", "-m", message]);
}

export function fixBranchName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `leakproof/fix-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** What the agent may not change through git itself: the commit, the branch, hide flags on tracked files, and git's config. */
export interface GitState {
  head: string;
  branch: string;
  flagged: string[];
  files: Record<string, string | undefined>;
}

const GIT_FILES = ["config", "info/exclude"];

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function gitState(root: string): Promise<GitState> {
  const gitDir = await git(root, ["rev-parse", "--absolute-git-dir"]);
  const branch = await git(root, ["symbolic-ref", "-q", "HEAD"]).catch(() => "");
  // `ls-files -v` marks assume-unchanged files with a lowercase tag and skip-worktree files with "S": both hide edits from status.
  const flagged = (await git(root, ["ls-files", "-v"], true)).split("\n").filter((l) => /^[a-zS] /.test(l)).map((l) => l.slice(2));
  const files = Object.fromEntries(GIT_FILES.map((f) => [f, readOrUndefined(join(gitDir, f))]));
  return { head: await git(root, ["rev-parse", "HEAD"]), branch, flagged, files };
}

export function sameGitState(a: GitState, b: GitState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Put the commit, branch, hide flags and git's config back as they were. Uncommitted edits are left to revertAll. */
export async function restoreGitState(root: string, state: GitState): Promise<void> {
  const gitDir = await git(root, ["rev-parse", "--absolute-git-dir"]);
  for (const [f, content] of Object.entries(state.files)) if (content !== undefined) writeFileSync(join(gitDir, f), content);
  const now = await gitState(root);
  const added = now.flagged.filter((p) => !state.flagged.includes(p));
  if (added.length > 0) await git(root, ["update-index", "--no-assume-unchanged", "--no-skip-worktree", "--", ...added]);
  if (now.branch !== state.branch && state.branch) await git(root, ["checkout", "-q", "-f", state.branch.replace(/^refs\/heads\//, "")]);
  if (now.head !== state.head) await git(root, ["reset", "-q", "--hard", state.head]);
}
