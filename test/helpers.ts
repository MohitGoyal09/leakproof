import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const FAKE_KANE = resolve("test/fixtures/fake-kane.mjs");

export function tempDir(prefix = "lp-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Point Leakproof at the fake Kane with a plan; returns the log path. */
export function useFakeKane(plan: Record<string, unknown>, secret?: string): string {
  const log = join(tempDir("lp-kane-"), "calls.log");
  process.env.LEAKPROOF_KANE_BIN = FAKE_KANE;
  process.env.FAKE_KANE_PLAN = JSON.stringify(plan);
  process.env.FAKE_KANE_LOG = log;
  if (secret) process.env.FAKE_KANE_SECRET = secret;
  else delete process.env.FAKE_KANE_SECRET;
  return log;
}

export function kaneCalls(log: string): { key?: string; argv: string[]; varsHadSecret: boolean }[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export const FAKE_CLAUDE = resolve("test/fixtures/fake-claude.mjs");

/** Point Leakproof at the fake Claude with a list of actions; returns the log path. */
export function useFakeClaude(plan: unknown[]): string {
  const log = join(tempDir("lp-claude-"), "calls.log");
  process.env.LEAKPROOF_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FAKE_CLAUDE_PLAN = JSON.stringify(plan);
  process.env.FAKE_CLAUDE_LOG = log;
  return log;
}

export function claudeCalls(log: string): { prompt: string; cwd: string; argv: string[]; envKeys: string[] }[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
