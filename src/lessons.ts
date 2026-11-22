import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeOwnFile } from "./guard.js";
import { CHECK_IDS, type CheckId, type Finding } from "./types.js";

/** What Kane taught Leakproof about one fix attempt: a rejected edit and why, or a proven fix and its commit. */
export interface Lesson {
  /** The finding id (flow:check). */
  id: string;
  check: CheckId;
  flow: string;
  outcome: "rejected" | "passed";
  files: string[];
  /** Why Kane's re-run still failed (rejected only). */
  reason?: string;
  /** The rejected edit, cut short. */
  diff?: string;
  /** The commit Leakproof made for the proven fix (passed only). */
  commit?: string;
  /** ISO time the lesson was learned. */
  at: string;
}

export const MAX_LESSONS = 50;
export const MAX_DIFF = 1500;
export const MAX_REASON = 500;

/** Cut `text` to `max` characters, marking the cut. */
export function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

const lessonSchema = z.object({
  id: z.string(),
  check: z.enum(CHECK_IDS as [CheckId, ...CheckId[]]),
  flow: z.string(),
  outcome: z.enum(["rejected", "passed"]),
  files: z.array(z.string()),
  reason: z.string().optional(),
  diff: z.string().optional(),
  commit: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
  at: z.string(),
});

const lessonsPath = (configDir: string) => join(configDir, ".leakproof", "lessons.json");

/** Lessons from earlier runs. A missing or broken file means none; entries with a wrong shape are dropped. */
export function loadLessons(configDir: string): Lesson[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(lessonsPath(configDir), "utf8"));
  } catch {
    return [];
  }
  const list = (raw as { lessons?: unknown })?.lessons;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const parsed = lessonSchema.safeParse(entry);
    return parsed.success ? [parsed.data as Lesson] : [];
  });
}

/** Write the lessons, keeping the newest MAX_LESSONS. */
export function saveLessons(configDir: string, lessons: readonly Lesson[]): void {
  const kept = lessons.slice(-MAX_LESSONS).map((l) => (l.diff ? { ...l, diff: cut(l.diff, MAX_DIFF) } : l));
  writeOwnFile(lessonsPath(configDir), `${JSON.stringify({ version: 1, lessons: kept }, null, 2)}\n`);
}

/** Lessons for the same check as `finding`: the same leak first, then other flows, newest first within each. */
export function lessonsFor(lessons: readonly Lesson[], finding: Finding, limit = 5): Lesson[] {
  const newest = (a: Lesson, b: Lesson) => b.at.localeCompare(a.at);
  const same = lessons.filter((l) => l.id === finding.id).sort(newest);
  const other = lessons.filter((l) => l.id !== finding.id && l.check === finding.check).sort(newest);
  return [...same, ...other].slice(0, limit);
}

/** Leaks found now that Kane proved fixed in an earlier run: they came back. */
export function cameBack(lessons: readonly Lesson[], findings: readonly Finding[]): { id: string; commit: string }[] {
  return findings.flatMap((f) => {
    const proven = lessons.filter((l) => l.id === f.id && l.outcome === "passed" && l.commit).at(-1);
    return proven?.commit ? [{ id: f.id, commit: proven.commit }] : [];
  });
}
