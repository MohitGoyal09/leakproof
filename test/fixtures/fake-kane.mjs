#!/usr/bin/env node
// Test double for kane-cli. FAKE_KANE_PLAN: {"<objective substring>": {"fixture": "fail", "exit": 1} | [ ...one per call ]}.
// Appends one JSON line per call to FAKE_KANE_LOG: {argv, varsHadSecret}.
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const objective = argv[1] ?? "";
const plan = JSON.parse(process.env.FAKE_KANE_PLAN ?? "{}");
const log = process.env.FAKE_KANE_LOG;
const varsPath = argv[argv.indexOf("--variables-file") + 1];
const secret = process.env.FAKE_KANE_SECRET;
const varsHadSecret = Boolean(secret && varsPath && existsSync(varsPath) && readFileSync(varsPath, "utf8").includes(secret));

// `kane-cli whoami`: logged in unless the plan says {"whoami": {"exit": 1}}.
if (argv[0] === "whoami") {
  if (log) appendFileSync(log, JSON.stringify({ key: "whoami", argv, varsHadSecret: false }) + "\n");
  process.stdout.write(plan.whoami?.exit ? "Not logged in\n" : "✓ Authenticated\n");
  process.exit(plan.whoami?.exit ?? 0);
}
const key = Object.keys(plan).find((k) => objective.includes(k));
let calls = 0;
if (log && existsSync(log)) calls = readFileSync(log, "utf8").split("\n").filter((l) => l && JSON.parse(l).key === key).length;
if (log) appendFileSync(log, JSON.stringify({ key, argv, varsHadSecret }) + "\n");
if (!key) { process.stdout.write(readFileSync(join(here, "ndjson", "pass.ndjson"))); process.exit(0); }
const entry = Array.isArray(plan[key]) ? plan[key][Math.min(calls, plan[key].length - 1)] : plan[key];
// "orphan": leave a child that holds stdout open, like Kane's real launcher does, then hang.
if (entry.orphan) {
  const { spawn } = await import("node:child_process");
  spawn(process.execPath, ["-e", `setTimeout(() => {}, ${entry.orphan})`], { stdio: ["ignore", "inherit", "inherit"] });
  await new Promise((r) => setTimeout(r, entry.orphan));
}
if (entry.sleep) await new Promise((r) => setTimeout(r, entry.sleep));
// "sessionDir": point run_end at a test-made session folder, so the run has its own evidence pack.
const out = readFileSync(join(here, "ndjson", `${entry.fixture}.ndjson`), "utf8");
process.stdout.write(entry.sessionDir ? out.replace(/"session_dir": "[^"]*"/g, `"session_dir": ${JSON.stringify(entry.sessionDir)}`) : out);
if (entry.stderr) process.stderr.write(entry.stderr);
process.stdout.write("some log line that is not json\n");
process.exit(entry.exit);
