#!/usr/bin/env node
// Test double for `claude -p`. FAKE_CLAUDE_PLAN: JSON list, one action per call:
// {"write": {"path": "x", "content": "y"}} | {"exit": n} | {"sleep": ms}. Logs each prompt to FAKE_CLAUDE_LOG.
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const log = process.env.FAKE_CLAUDE_LOG;
const plan = JSON.parse(process.env.FAKE_CLAUDE_PLAN ?? "[]");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const calls = log && existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
if (log) appendFileSync(log, JSON.stringify({ prompt, cwd: process.cwd(), argv: process.argv.slice(2) }) + "\n");
const action = plan[Math.min(calls, plan.length - 1)] ?? {};
if (action.sleep) await new Promise((r) => setTimeout(r, action.sleep));
if (action.write) {
  const p = join(process.cwd(), action.write.path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, action.write.content);
}
process.stdout.write(action.stdout ?? JSON.stringify({ type: "result", result: "done" }));
process.exit(action.exit ?? 0);
