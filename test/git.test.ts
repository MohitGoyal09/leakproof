import { describe, expect, it } from "vitest";
import { parsePorcelain } from "../src/git.js";

describe("parsePorcelain", () => {
  it("keeps the first character of the first path", () => {
    expect(parsePorcelain(" M app.js\0?? new/file.ts\0")).toEqual(["app.js", "new/file.ts"]);
  });

  it("takes the new path of a rename and skips the original", () => {
    expect(parsePorcelain("R  b.ts\0a.ts\0 M c.ts\0")).toEqual(["b.ts", "c.ts"]);
  });

  it("ignores Leakproof's own output folder", () => {
    expect(parsePorcelain("?? .leakproof/report.html\0?? sub/.leakproof/x\0 M y.ts\0")).toEqual(["y.ts"]);
  });

  it("keeps paths with spaces intact", () => {
    expect(parsePorcelain("?? my file.ts\0")).toEqual(["my file.ts"]);
  });
});
