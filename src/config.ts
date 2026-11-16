import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { CHECK_IDS, type CheckId, type Config } from "./types.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

const checkId = z.enum(CHECK_IDS as [CheckId, ...CheckId[]]);

const stepSchema = z.union([
  z.string().min(1),
  z.object({ do: z.string().min(1), checks: z.array(checkId).optional() }),
]);

const schema = z.object({
  url: z.string().url().refine((u) => /^https?:\/\//.test(u), "must start with http:// or https://"),
  start: z.string().min(1).optional(),
  env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name")).default([]),
  checks: z.object({ vitals: z.object({ slow_ms: z.number().int().positive().default(1000) }).default({}) }).default({}),
  flows: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
        checks: z.array(checkId).min(1),
        steps: z.array(stepSchema).min(1, "needs at least one step"),
      }),
    )
    .min(1, "needs at least one flow"),
});

function issuePath(path: (string | number)[]): string {
  return path.reduce<string>((acc, part) => (typeof part === "number" ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part), "");
}

/** Load and validate leakproof.yml. Throws ConfigError naming the bad field or missing env var. */
export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): Config {
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Could not read ${path}: ${why}`);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ConfigError(`${path}: ${issuePath(issue.path) || "(root)"} ${issue.message}`);
  }
  const data = result.data;

  const missing = data.env.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new ConfigError(`Set these environment variables before running Leakproof: ${missing.join(", ")}`);
  }

  const configPath = resolve(path);
  return {
    url: data.url.replace(/\/$/, ""),
    start: data.start,
    env: data.env,
    vitals: { slowMs: data.checks.vitals.slow_ms },
    flows: data.flows.map((f) => ({
      name: f.name,
      checks: f.checks,
      steps: f.steps.map((s) => (typeof s === "string" ? { do: s } : s)),
    })),
    configDir: dirname(configPath),
    configPath,
    secrets: Object.fromEntries(data.env.map((name) => [name, env[name] as string])),
  };
}
