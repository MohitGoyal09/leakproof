import { describe, expect, it } from "vitest";
import { assertionFor } from "../src/checks.js";
import { loadConfig } from "../src/config.js";
import { buildUnits } from "../src/objective.js";
import type { Config } from "../src/types.js";

const shop = (): Config => loadConfig("examples/shop/leakproof.yml", { SHOP_USER: "d", SHOP_PASS: "p" });
const ctx = { appHost: "localhost:3000", vitals: { slowMs: 1000 } };
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("buildUnits", () => {
  it("one unit per flow and check", () => {
    expect(buildUnits(shop()).map((u) => u.id)).toEqual([
      "home:network",
      "home:vitals",
      "add-to-cart:console",
      "checkout:cookies",
      "checkout:storage",
      "checkout:env-leak",
    ]);
  });

  it("step-scoped check goes on every step when no step names it", () => {
    const unit = buildUnits(shop()).find((u) => u.id === "add-to-cart:console")!;
    expect(count(unit.objective, assertionFor("console", ctx))).toBe(2);
    expect(unit.objective.split("\n")).toHaveLength(2);
  });

  it("state-scoped check goes on the last step", () => {
    const unit = buildUnits(shop()).find((u) => u.id === "checkout:cookies")!;
    const [first, second] = unit.objective.split("\n");
    expect(first).not.toContain("HttpOnly");
    expect(second).toContain(`In this same step, ${assertionFor("cookies", ctx)}`);
  });

  it("explicit step placement wins", () => {
    const c = shop();
    const custom: Config = {
      ...c,
      flows: [{ name: "x", checks: ["network"], steps: [{ do: "Open the page", checks: ["network"] }, { do: "Click buy" }] }],
    };
    const [unit] = buildUnits(custom);
    const [first, second] = unit.objective.split("\n");
    expect(first).toContain(assertionFor("network", ctx));
    expect(second).not.toContain("network request");
  });

  it("numbers steps and expands relative paths against the app url", () => {
    const unit = buildUnits(shop()).find((u) => u.id === "checkout:storage")!;
    expect(unit.objective.startsWith("1. Open http://localhost:3000/login and sign in with username {{SHOP_USER}}")).toBe(true);
    expect(unit.objective.split("\n")[1].startsWith("2. Open http://localhost:3000/checkout")).toBe(true);
  });

  it("keeps variable placeholders and never inlines secret values", () => {
    const unit = buildUnits(shop()).find((u) => u.id === "checkout:cookies")!;
    expect(unit.objective).toContain("{{SHOP_PASS}}");
    expect(unit.objective).not.toMatch(/password p\b/);
  });
});

describe("assertionFor", () => {
  it("env-leak excludes the app host", () => {
    expect(assertionFor("env-leak", ctx)).toContain("other than localhost:3000");
  });

  it("vitals uses the slow threshold", () => {
    expect(assertionFor("vitals", { ...ctx, vitals: { slowMs: 1500 } })).toContain("under 1500 ms");
  });

  it("console ignores resource-load errors owned by the network check", () => {
    expect(assertionFor("console", ctx)).toContain("other than 'Failed to load resource'");
  });

  it("has one assertion per check id", () => {
    for (const id of ["cookies", "storage", "network", "console", "env-leak", "vitals"] as const) {
      expect(assertionFor(id, ctx)).toMatch(/^assert that /);
    }
  });
});
