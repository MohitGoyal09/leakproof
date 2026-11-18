import { describe, expect, it } from "vitest";
import { parsePorcelain } from "../src/git.js";

describe("parsePorcelain", () => {
  it("keeps the first character of the first path", () => {
    expect(parsePorcelain(" M app.js\0?? new/file.ts\0")).toEqual(["app.js", "new/file.ts"]);
  });

  it("reports both paths of a rename, and only the new path of a copy", () => {
    expect(parsePorcelain("R  b.ts\0a.ts\0 M c.ts\0")).toEqual(["b.ts", "a.ts", "c.ts"]);
    expect(parsePorcelain("C  d.ts\0a.ts\0")).toEqual(["d.ts"]);
  });

  it("ignores Leakproof's own output folder, and only that one", () => {
    expect(parsePorcelain("?? .leakproof/report.html\0?? sub/.leakproof/x\0 M y.ts\0")).toEqual(["sub/.leakproof/x", "y.ts"]);
    expect(parsePorcelain("?? sub/.leakproof/x\0?? .leakproof/y\0", "sub/.leakproof")).toEqual([".leakproof/y"]);
  });

  it("keeps paths with spaces intact", () => {
    expect(parsePorcelain("?? my file.ts\0")).toEqual(["my file.ts"]);
  });
});
