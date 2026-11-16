import { execa } from "execa";

const OUTPUT_DIR = ".leakproof";

async function git(cwd: string, args: string[], raw = false): Promise<string> {
  const res = await execa("git", args, { cwd, reject: false, stripFinalNewline: !raw });
  if (res.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${String(res.stderr || res.stdout).trim()}`);
  return raw ? String(res.stdout) : String(res.stdout).trim();
}

export async function repoRoot(dir: string): Promise<string> {
  return git(dir, ["rev-parse", "--show-toplevel"]);
}

/** Parse `git status --porcelain -z`: "XY path\0", with an extra "orig\0" after renames and copies. */
export function parsePorcelain(out: string): string[] {
  const parts = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return paths.filter((path) => !path.split("/").includes(OUTPUT_DIR));
}

/** Files changed, added or untracked (not ignored) relative to the repo root, excluding Leakproof's own output. */
export async function changedFiles(root: string): Promise<string[]> {
  return parsePorcelain(await git(root, ["status", "--porcelain", "-z", "--untracked-files=all"], true));
}

export async function isClean(root: string): Promise<boolean> {
  return (await changedFiles(root)).length === 0;
}

/** Throw away every uncommitted change, keeping Leakproof's output folder. */
export async function revertAll(root: string): Promise<void> {
  await git(root, ["checkout", "--", "."]);
  await git(root, ["clean", "-fd", "-e", OUTPUT_DIR]);
}

export async function createBranch(root: string, name: string): Promise<void> {
  await git(root, ["checkout", "-q", "-b", name]);
}

export async function commitAll(root: string, message: string): Promise<void> {
  const files = await changedFiles(root);
  await git(root, ["add", "--", ...files]);
  await git(root, ["commit", "-q", "-m", message]);
}

export function fixBranchName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `leakproof/fix-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
