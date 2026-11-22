import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cameBack, lessonsFor, loadLessons, MAX_LESSONS, saveLessons, type Lesson } from "../src/lessons.js";
import type { Finding } from "../src/types.js";
import { tempDir } from "./helpers.js";

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: "checkout:cookies",
  check: "cookies",
  flow: "checkout",
  outcome: "rejected",
  files: ["app.js"],
  reason: "cookie is not marked Secure",
  at: "2026-11-21T10:00:00.000Z",
  ...over,
});

const finding = (id: string, check: Finding["check"]): Finding => ({
  id,
  check,
  flow: id.split(":")[0],
  assertion: "a",
  evidence: [],
  title: "t",
  reason: "r",
  summary: "s",
});

describe("loadLessons", () => {
  it("returns no lessons when there is no file yet", () => {
    expect(loadLessons(tempDir())).toEqual([]);
  });

  it("returns no lessons when the file is not JSON", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".leakproof"));
    writeFileSync(join(dir, ".leakproof", "lessons.json"), "{not json");
    expect(loadLessons(dir)).toEqual([]);
  });

  it("drops entries with a wrong shape and keeps the good ones", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".leakproof"));
    const good = lesson();
    const bad = [{ ...good, outcome: "maybe" }, { ...good, check: "made-up" }, { ...good, files: "app.js" }, "text", null];
    writeFileSync(join(dir, ".leakproof", "lessons.json"), JSON.stringify({ lessons: [good, ...bad] }));
    expect(loadLessons(dir)).toEqual([good]);
  });
});

describe("saveLessons", () => {
  it("round-trips and keeps only the newest lessons", () => {
    const dir = tempDir();
    const many = Array.from({ length: MAX_LESSONS + 5 }, (_, i) => lesson({ reason: `r${i}` }));
    saveLessons(dir, many);
    const back = loadLessons(dir);
    expect(back).toHaveLength(MAX_LESSONS);
    expect(back[0].reason).toBe("r5");
    expect(back.at(-1)?.reason).toBe(`r${MAX_LESSONS + 4}`);
    expect(JSON.parse(readFileSync(join(dir, ".leakproof", "lessons.json"), "utf8")).version).toBe(1);
  });
});

describe("lessonsFor", () => {
  it("picks lessons for the same check, the same leak first, newest first", () => {
    const old = lesson({ at: "2026-11-01T00:00:00.000Z", reason: "old" });
    const recent = lesson({ at: "2026-11-20T00:00:00.000Z", reason: "recent" });
    const otherFlow = lesson({ id: "login:cookies", flow: "login", at: "2026-11-21T00:00:00.000Z", reason: "other flow" });
    const otherCheck = lesson({ id: "checkout:storage", check: "storage", reason: "storage" });
    const picked = lessonsFor([old, otherCheck, otherFlow, recent], finding("checkout:cookies", "cookies"));
    expect(picked.map((l) => l.reason)).toEqual(["recent", "old", "other flow"]);
  });

  it("returns at most the limit", () => {
    const all = Array.from({ length: 9 }, (_, i) => lesson({ reason: `r${i}` }));
    expect(lessonsFor(all, finding("checkout:cookies", "cookies"), 3)).toHaveLength(3);
  });
});

describe("cameBack", () => {
  it("names the commit of an earlier proven fix for a leak found again", () => {
    const passed = lesson({ outcome: "passed", commit: "abc1234def", reason: undefined });
    const found = [finding("checkout:cookies", "cookies"), finding("home:network", "network")];
    expect(cameBack([passed, lesson()], found)).toEqual([{ id: "checkout:cookies", commit: "abc1234def" }]);
  });
});
