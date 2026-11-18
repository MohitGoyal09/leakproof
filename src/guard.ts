import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ignoredFiles } from "./git.js";

/** Build and start files the agent may not touch: changing them can make a check pass without fixing the leak. */
const BUILD_FILE =
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|tsconfig(\.[\w-]+)?\.json|[\w-]+\.config\.(js|cjs|mjs|ts|cts|mts))$/;

export function isBuildFile(path: string): boolean {
  return BUILD_FILE.test(path);
}

// Build output and dependencies change when the agent builds or tests its work, so they are not watched.
// ponytail: node_modules is not watched; a patched dependency would pass unseen. Hash it if that ever matters.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".turbo", ".cache", ".vercel",
  ".venv", "venv", "__pycache__", "target", "vendor", ".yarn", ".pnpm-store",
]);
const MAX_SAVED_BYTES = 1_000_000;

interface Entry {
  sig: string;
  content?: Buffer;
}
export type IgnoredSnapshot = Map<string, Entry>;

function watched(path: string, outputDir: string): boolean {
  if (path === outputDir || path.startsWith(`${outputDir}/`) || path.endsWith(".tsbuildinfo")) return false;
  return !path.split("/").some((part) => SKIP_DIRS.has(part));
}

function entry(root: string, path: string): Entry | undefined {
  try {
    const st = statSync(join(root, path));
    const content = st.size <= MAX_SAVED_BYTES ? readFileSync(join(root, path)) : undefined;
    return { sig: content ? createHash("sha1").update(content).digest("hex") : `${st.size}:${st.mtimeMs}`, content };
  } catch {
    return undefined;
  }
}

/** Contents of the gitignored files the agent could hide a fix in (.env files, logs, stray folders). */
export async function snapshotIgnored(root: string, outputDir: string): Promise<IgnoredSnapshot> {
  const snap: IgnoredSnapshot = new Map();
  for (const path of await ignoredFiles(root)) {
    if (!watched(path, outputDir)) continue;
    const e = entry(root, path);
    if (e) snap.set(path, e);
  }
  return snap;
}

/** Ignored files created, changed or deleted since the snapshot. */
export async function ignoredChanges(root: string, outputDir: string, before: IgnoredSnapshot): Promise<string[]> {
  const after = await snapshotIgnored(root, outputDir);
  const changed = [...after].filter(([path, e]) => before.get(path)?.sig !== e.sig).map(([path]) => path);
  const deleted = [...before.keys()].filter((path) => !after.has(path));
  return [...changed, ...deleted];
}

/** Put the listed ignored files back as they were: delete new ones, restore saved contents. */
export function restoreIgnored(root: string, before: IgnoredSnapshot, paths: readonly string[]): void {
  for (const path of paths) {
    const saved = before.get(path);
    const abs = join(root, path);
    if (!saved) {
      rmSync(abs, { force: true });
    } else if (saved.content) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, saved.content);
    }
  }
}
