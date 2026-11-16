import { describe, expect, it } from "vitest";
import { mapLimit } from "../src/pool.js";

describe("mapLimit", () => {
  it("never exceeds the limit and keeps input order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([...Array(10).keys()], 4, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5 + (n % 3) * 5));
      active--;
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it("handles an empty list", async () => {
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([]);
  });
});
