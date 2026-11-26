#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { stopAllApps } from "./app.js";
import { loadConfig } from "./config.js";
import { fixAll, interruptFix } from "./fixer.js";
import { checkKaneLogin, removeVarsFiles, stopAllKane } from "./kane.js";
import { runInit } from "./init.js";
import { writeReport } from "./report/html.js";
import { clean, formatAttempt, formatExhibitHead, formatFixSummary, formatHeader, formatRow, formatSummary } from "./report/terminal.js";
import { exitCodeFor, outDir, scan } from "./scan.js";
import { isAncestor } from "./git.js";
import { writeCiOutputs } from "./ci.js";
import { cameBack, loadLessons } from "./lessons.js";
import { CHECK_IDS, type CheckId } from "./types.js";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  width: number;
}

const defaultIo: Io = {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
  width: process.stdout.columns || 100,
};

class UsageError extends Error {}

function parseCheck(value: string): CheckId {
  if (!(CHECK_IDS as readonly string[]).includes(value)) {
    throw new UsageError(`Unknown check "${value}". Use one of: ${CHECK_IDS.join(", ")}`);
  }
  return value as CheckId;
}

const CONFIRM_HELP = "count a failed check after one Kane run (by default it is run again, and a split goes to a third run)";

async function scanCommand(opts: { config: string; only?: string; flow?: string; confirm: boolean }, io: Io): Promise<number> {
  const config = loadConfig(opts.config);
  const only = opts.only ? parseCheck(opts.only) : undefined;
  const flows = config.flows.filter((f) => (!opts.flow || f.name === opts.flow) && (!only || f.checks.includes(only)));
  const units = flows.reduce((n, f) => n + f.checks.filter((c) => !only || c === only).length, 0);
  if (units === 0) throw new UsageError("No checks match --only and --flow. Nothing to scan.");
  await checkKaneLogin();
  io.out(formatHeader(config.url, units, flows.length));
  const t0 = Date.now();
  const report = await scan(config, { only, flow: opts.flow, confirm: opts.confirm, onResult: (row) => io.out(formatRow(row, io.width)) });
  const html = writeReport(config.configDir, { before: report }, Object.values(config.secrets));
  io.out(formatSummary(report, Date.now() - t0, relative(process.cwd(), html) || html));
  writeCiOutputs(report, process.env, io.out);
  for (const back of cameBack(loadLessons(config.configDir), report.findings)) {
    const name = back.id.replace(/:(?=[^:]*$)/, " ");
    const commit = back.commit.slice(0, 7);
    const line = (await isAncestor(config.configDir, back.commit))
      ? `This leak came back: ${name} was proven fixed by Kane in commit ${commit}.`
      : `${name}: Kane proved a fix in commit ${commit}, but that commit is not in this branch.`;
    io.out(`  ${clean(line)}`);
  }
  return exitCodeFor(report);
}

async function fixCommand(opts: { config: string; maxAttempts: string; agent: string; confirm: boolean }, io: Io): Promise<number> {
  if (opts.agent !== "claude") throw new UsageError(`Unsupported agent "${opts.agent}". Only "claude" is supported right now.`);
  const maxAttempts = Number.parseInt(opts.maxAttempts, 10);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new UsageError("--max-attempts must be a whole number from 1 to 10.");
  const config = loadConfig(opts.config);
  await checkKaneLogin();
  const units = config.flows.reduce((n, f) => n + f.checks.length, 0);
  io.out(formatHeader(config.url, units, config.flows.length));
  if (!config.start) {
    io.err("  Warning: leakproof.yml has no start command, so Leakproof cannot restart your app after each edit. Kane only sees a fix if your app reloads code by itself (a dev server with hot reload).");
  }
  const t0 = Date.now();
  let ref = 0;
  let current = "";
  const report = await fixAll(config, {
    maxAttempts,
    confirm: opts.confirm,
    onScanResult: (row) => io.out(formatRow(row, io.width)),
    onEvent: (e) => {
      if (e.type === "scanned") io.out(`\n  ${e.findings === 0 ? "Nothing to fix." : `${e.findings} leak${e.findings === 1 ? "" : "s"} found. Handing each one to Claude Code, then asking Kane to prove the fix.`}`);
      if (e.type === "attempt" && e.finding.id !== current) {
        current = e.finding.id;
        io.out(formatExhibitHead(String.fromCharCode(65 + ref++), e.finding));
      }
      if (e.type === "attempt-result") io.out(formatAttempt(e.result, io.width));
      if (e.type === "rescan") io.out("\n  Re-scanning every flow to catch regressions\n");
      if (e.type === "recheck") io.out(`  The re-scan found ${e.findings} leak${e.findings === 1 ? "" : "s"} that ${e.findings === 1 ? "is" : "are"} not settled (missed before, or broken by a later fix). Fixing ${e.findings === 1 ? "it" : "them"} too.`);
    },
  });
  const html = `${outDir(config)}/report.html`;
  io.out(formatFixSummary(report, Date.now() - t0, relative(process.cwd(), html) || html));
  writeCiOutputs(report, process.env, io.out);
  return report.after && report.after.errors.length > 0 ? 2 : (report.after?.findings.length ?? 0) > 0 ? 1 : 0;
}

/** Run the CLI. Returns the exit code instead of exiting, so it can be tested in process. */
export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  let code = 0;
  const program = new Command()
    .name("leakproof")
    .description("Find the leaks a screenshot can't see, fix them with a coding agent, and prove every fix with Kane CLI.")
    .version((JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version)
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.out(s.trimEnd()), writeErr: (s) => io.err(s.trimEnd()) });

  program
    .command("scan")
    .description("Walk every flow in leakproof.yml through Kane and report hidden leaks")
    .option("-c, --config <path>", "path to leakproof.yml", "leakproof.yml")
    .option("--only <check>", `run one check: ${CHECK_IDS.join(", ")}`)
    .option("--flow <name>", "run one flow")
    .option("--no-confirm", CONFIRM_HELP)
    .action(async (opts) => {
      code = await scanCommand(opts, io);
    });

  program
    .command("init")
    .description("Write a starter leakproof.yml in this folder")
    .action(() => {
      const { configPath, gitignoreUpdated } = runInit(process.cwd());
      io.out(`\n  Wrote ${relative(process.cwd(), configPath)}${gitignoreUpdated ? " and added .leakproof/ to .gitignore" : ""}.`);
      io.out("  Edit the url and flows, export the variables listed under env, then run: leakproof scan\n");
    });

  program
    .command("report")
    .description("Print the path of the last HTML report")
    .option("-c, --config <path>", "path to leakproof.yml", "leakproof.yml")
    .action((opts: { config: string }) => {
      const path = join(dirname(resolve(opts.config)), ".leakproof", "report.html");
      if (!existsSync(path)) throw new UsageError("No report yet. Run: leakproof scan");
      io.out(path);
    });

  program
    .command("fix")
    .description("Scan, have Claude Code fix each leak, prove every fix with a Kane re-run, and commit it on a new branch")
    .option("-c, --config <path>", "path to leakproof.yml", "leakproof.yml")
    .option("--max-attempts <n>", "attempts per leak", "3")
    .option("--agent <name>", "coding agent", "claude")
    .option("--no-confirm", CONFIRM_HELP)
    .action(async (opts) => {
      code = await fixCommand(opts, io);
    });

  try {
    await program.parseAsync(argv);
  } catch (error: unknown) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    const message = error instanceof Error ? error.message : String(error);
    io.err(`\nleakproof: ${message}`);
    if (process.env.DEBUG?.includes("leakproof") && error instanceof Error && error.stack) io.err(error.stack);
    return 2;
  }
  return code;
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const onSignal = (sig: NodeJS.Signals) => {
    process.stderr.write(`\nleakproof: ${sig} received, undoing unproven edits and stopping the app\n`);
    removeVarsFiles();
    stopAllKane();
    void Promise.allSettled([interruptFix(), stopAllApps()]).finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  main(process.argv).then((c) => process.exit(c));
}
