import { assertionFor, STEP_SCOPED, type AssertionContext } from "./checks.js";
import type { CheckId, Config, Flow, RunUnit } from "./types.js";

/** Turn "Open /login" into "Open http://host/login" so Kane never has to guess the base URL. */
function expandPaths(text: string, baseUrl: string): string {
  return text.replace(/(^|\s)(\/[A-Za-z0-9][\w\-./?=&%#]*)/g, (_m, lead: string, path: string) => `${lead}${baseUrl}${path}`);
}

function stepsFor(flow: Flow, check: CheckId): number[] {
  const explicit = flow.steps.flatMap((s, i) => (s.checks?.includes(check) ? [i] : []));
  if (explicit.length > 0) return explicit;
  if (STEP_SCOPED.includes(check)) return flow.steps.map((_, i) => i);
  return [flow.steps.length - 1];
}

export function buildObjective(flow: Flow, check: CheckId, config: Config): string {
  const ctx: AssertionContext = { appHostname: new URL(config.url).hostname, vitals: config.vitals };
  const assertion = assertionFor(check, ctx);
  const placed = new Set(stepsFor(flow, check));
  return flow.steps
    .map((step, i) => {
      const action = expandPaths(step.do.trim().replace(/\.$/, ""), config.url);
      return placed.has(i) ? `${i + 1}. ${action}. In this same step, ${assertion}` : `${i + 1}. ${action}.`;
    })
    .join("\n");
}

/** One run unit per (flow, check), in config order. Unit id is `flow:check`. */
export function buildUnits(config: Config): RunUnit[] {
  return config.flows.flatMap((flow) =>
    flow.checks.map((check) => ({ id: `${flow.name}:${check}`, flow: flow.name, check, objective: buildObjective(flow, check, config) })),
  );
}
