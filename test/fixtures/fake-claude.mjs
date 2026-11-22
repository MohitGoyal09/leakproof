#!/usr/bin/env node
// Test double for `claude -p`. FAKE_CLAUDE_PLAN: JSON list, one action per call:
// {"write": {"path": "x", "content": "y"}, "git": [[...args], ...], "symlink": {"target", "path"}} | {"exit": n} | {"sleep": ms}.
// Logs each prompt, and the names of the env vars it got, to FAKE_CLAUDE_LOG.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const log = process.env.FAKE_CLAUDE_LOG;
const plan = JSON.parse(process.env.FAKE_CLAUDE_PLAN ?? "[]");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const calls = log && existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
if (log) appendFileSync(log, JSON.stringify({ prompt, cwd: process.cwd(), argv: process.argv.slice(2), envKeys: Object.keys(process.env) }) + "\n");
const action = plan[Math.min(calls, plan.length - 1)] ?? {};
if (action.sleep) await new Promise((r) => setTimeout(r, action.sleep));
if (action.write) {
  const p = join(process.cwd(), action.write.path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, action.write.content);
}
if (action.symlink) symlinkSync(action.symlink.target, join(process.cwd(), action.symlink.path));
for (const args of action.git ?? []) execFileSync("git", args, { cwd: process.cwd(), stdio: "ignore" });
// FAKE_CLAUDE_EXTRA: {"path", "content", "onCall": n}: one more file written on call n (1-based).
const extra = process.env.FAKE_CLAUDE_EXTRA ? JSON.parse(process.env.FAKE_CLAUDE_EXTRA) : undefined;
if (extra && extra.onCall === calls + 1) {
  const p = join(process.cwd(), extra.path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, extra.content);
}
process.stdout.write(action.stdout ?? JSON.stringify({ type: "result", result: "done" }));
process.exit(action.exit ?? 0);
