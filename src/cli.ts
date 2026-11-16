#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { loadConfig } from "./config.js";
import { formatHeader, formatRow, formatSummary } from "./report/terminal.js";
import { exitCodeFor, outDir, scan } from "./scan.js";
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

async function scanCommand(opts: { config: string; only?: string; flow?: string }, io: Io): Promise<number> {
  const config = loadConfig(opts.config);
  const only = opts.only ? parseCheck(opts.only) : undefined;
  const flows = config.flows.filter((f) => (!opts.flow || f.name === opts.flow) && (!only || f.checks.includes(only)));
  const units = flows.reduce((n, f) => n + f.checks.filter((c) => !only || c === only).length, 0);
  io.out(formatHeader(config.url, units, flows.length));
  const t0 = Date.now();
  const report = await scan(config, { only, flow: opts.flow, onResult: (row) => io.out(formatRow(row, io.width)) });
  io.out(formatSummary(report, Date.now() - t0, relative(process.cwd(), `${outDir(config)}/findings.json`)));
  return exitCodeFor(report);
}

/** Run the CLI. Returns the exit code instead of exiting, so it can be tested in process. */
export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  let code = 0;
  const program = new Command()
    .name("leakproof")
    .description("Find the leaks a screenshot can't see, fix them with a coding agent, and prove every fix with Kane CLI.")
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.out(s.trimEnd()), writeErr: (s) => io.err(s.trimEnd()) });

  program
    .command("scan")
    .description("Walk every flow in leakproof.yml through Kane and report hidden leaks")
    .option("-c, --config <path>", "path to leakproof.yml", "leakproof.yml")
    .option("--only <check>", `run one check: ${CHECK_IDS.join(", ")}`)
    .option("--flow <name>", "run one flow")
    .action(async (opts) => {
      code = await scanCommand(opts, io);
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
  main(process.argv).then((c) => process.exit(c));
}
