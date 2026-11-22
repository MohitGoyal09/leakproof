import type { Lesson } from "./lessons.js";

export type CheckId = "cookies" | "storage" | "network" | "console" | "env-leak" | "vitals";

export const CHECK_IDS: readonly CheckId[] = ["cookies", "storage", "network", "console", "env-leak", "vitals"];

export interface Step {
  do: string;
  checks?: CheckId[];
}

export interface Flow {
  name: string;
  checks: CheckId[];
  steps: Step[];
}

export interface Vitals {
  slowMs: number;
}

export interface Config {
  url: string;
  start?: string;
  env: string[];
  vitals: Vitals;
  flows: Flow[];
  configDir: string;
  configPath: string;
  /** Values of the `env` names, read from the environment. Never printed or written to reports. */
  secrets: Record<string, string>;
}

export interface RunUnit {
  id: string;
  flow: string;
  check: CheckId;
  objective: string;
}

export interface KaneVerdict {
  bugTitle?: string;
  rootCause?: string;
  suggestion?: string;
  oneLiner?: string;
  confidence?: number;
  confirmed?: boolean;
}

export interface KaneResult {
  status: "passed" | "failed" | "error" | "timeout";
  exitCode: number;
  reasonCode?: string;
  summary: string;
  reason?: string;
  verdict?: KaneVerdict;
  finalState: Record<string, string>;
  runDir?: string;
  sessionDir?: string;
  testUrl?: string;
  credits?: number;
}

export interface Finding {
  id: string;
  check: CheckId;
  flow: string;
  assertion: string;
  offender?: string;
  evidence: string[];
  title: string;
  reason: string;
  summary: string;
  suggestion?: string;
  runDir?: string;
  testUrl?: string;
  screenshot?: string;
}

export interface FixAttempt {
  attempt: number;
  files: string[];
  verdict: "fixed" | "still-failing" | "rejected" | "error";
  note?: string;
  /** The Kane run that proved the fix. */
  testUrl?: string;
}

export interface FindingOutcome {
  finding: Finding;
  attempts: FixAttempt[];
  fixed: boolean;
}

export interface UnitResult {
  unit: string;
  status: KaneResult["status"];
  credits?: number;
  /** Each Kane run's status when a failure was re-checked (confirm), in order. */
  votes?: KaneResult["status"][];
}

export interface ScanReport {
  startedAt: string;
  url: string;
  units: number;
  results: UnitResult[];
  findings: Finding[];
  errors: { unit: string; message: string }[];
  credits: number;
}

export interface FullReport {
  before: ScanReport;
  outcomes?: FindingOutcome[];
  after?: ScanReport;
  /** Kane credits spent outside the first scan and the final scan: fix re-runs and any extra re-scan. */
  extraCredits?: number;
  /** Lessons from earlier runs that went into this run's prompts, and the lessons this run saved. */
  lessons?: { used: number; learned: Lesson[] };
}
