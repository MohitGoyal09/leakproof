import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exitCodeFor, scan } from "../src/scan.js";
import type { Config } from "../src/types.js";
import { kaneCalls, tempDir, useFakeKane } from "./helpers.js";
import { loadConfig } from "../src/config.js";

let server: Server;
let url: string;

beforeEach(async () => {
  server = createServer((_q, s) => s.end("ok"));
  await new Promise<void>((r) => server.listen(0, () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => server.close());

const KEYS = {
  network: "status of 500",
  vitals: "finished in under",
  console: "level 'error'",
  cookies: "HttpOnly",
  storage: "localStorage key",
  envLeak: "contains 'staging'",
};

function shopConfig(): Config {
  const c = loadConfig("examples/shop/leakproof.yml", { SHOP_USER: "demo", SHOP_PASS: "demo123" });
  return { ...c, url, start: undefined, configDir: tempDir("lp-scan-") };
}

const all = (fixture: string, exit: number) => Object.fromEntries(Object.values(KEYS).map((k) => [k, { fixture, exit }]));

describe("scan with confirm", () => {
  const storageOnly = (plan: unknown) => ({ ...all("pass", 0), [KEYS.storage]: plan });
  const storageCalls = (log: string) => kaneCalls(log).filter((c) => c.key === KEYS.storage).length;

  it("counts a leak that Kane finds again on a second run", async () => {
    const log = useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "fail", exit: 1 }]));
    const report = await scan(shopConfig(), { confirm: true });
    expect(report.findings.map((f) => f.id)).toEqual(["checkout:storage"]);
    expect(report.results.find((r) => r.unit === "checkout:storage")?.votes).toEqual(["failed", "failed"]);
    expect(storageCalls(log)).toBe(2);
  });

  it("does not count a failure that two more runs do not repeat", async () => {
    const log = useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "pass", exit: 0 }]));
    const report = await scan(shopConfig(), { confirm: true });
    expect(report.findings).toEqual([]);
    expect(report.results.find((r) => r.unit === "checkout:storage")).toMatchObject({ status: "passed", votes: ["failed", "passed", "passed"] });
    expect(exitCodeFor(report)).toBe(0);
    expect(storageCalls(log)).toBe(3);
  });

  it("lets a third run settle a split, so one missed run cannot hide a real leak", async () => {
    useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "fail", exit: 1 }]));
    const report = await scan(shopConfig(), { confirm: true });
    expect(report.findings.map((f) => f.id)).toEqual(["checkout:storage"]);
    expect(report.results.find((r) => r.unit === "checkout:storage")?.votes).toEqual(["failed", "passed", "failed"]);
  });

  it("adds every run's credits", async () => {
    useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "fail", exit: 1 }]));
    const once = await scan(shopConfig());
    useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "fail", exit: 1 }]));
    const twice = await scan(shopConfig(), { confirm: true });
    const storage = (r: typeof once) => r.results.find((x) => x.unit === "checkout:storage")!.credits ?? 0;
    expect(storage(twice)).toBeCloseTo(storage(once) * 2);
  });

  it("a tie with a run that could not finish is an error, not a leak", async () => {
    const i = { fixture: "infra", exit: 1 };
    useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, i, i]));
    const report = await scan(shopConfig(), { confirm: true });
    expect(report.findings).toEqual([]);
    expect(report.errors.map((e) => e.unit)).toEqual(["checkout:storage"]);
    expect(report.results.find((r) => r.unit === "checkout:storage")?.votes).toEqual(["failed", "passed", "error"]);
    expect(exitCodeFor(report)).toBe(2);
  });

  it("keeps the failure when the re-check could not run, and says so", async () => {
    const i = { fixture: "infra", exit: 1 };
    useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, i, i]));
    const report = await scan(shopConfig(), { confirm: true });
    expect(report.findings.map((f) => f.id)).toEqual(["checkout:storage"]);
    expect(report.results.find((r) => r.unit === "checkout:storage")?.votes).toEqual(["failed", "error"]);
  });

  it("keeps each re-run's Kane log instead of overwriting the first", async () => {
    useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }, { fixture: "pass", exit: 0 }]));
    const c = shopConfig();
    await scan(c, { confirm: true });
    const runs = join(c.configDir, ".leakproof", "runs");
    for (const name of ["checkout__storage.ndjson", "checkout__storage.vote2.ndjson", "checkout__storage.vote3.ndjson"]) {
      expect(existsSync(join(runs, name)), name).toBe(true);
    }
  });

  it("runs each check once without confirm", async () => {
    const log = useFakeKane(storageOnly([{ fixture: "fail", exit: 1 }, { fixture: "pass", exit: 0 }]));
    const report = await scan(shopConfig());
    expect(report.findings).toHaveLength(1);
    expect(storageCalls(log)).toBe(1);
  });
});

describe("scan", () => {
  it("six failing units give six findings and exit 1", async () => {
    useFakeKane(all("fail", 1));
    const report = await scan(shopConfig());
    expect(report.findings).toHaveLength(6);
    expect(exitCodeFor(report)).toBe(1);
  });

  it("all passing gives exit 0 and an empty findings.json", async () => {
    useFakeKane(all("pass", 0));
    const c = shopConfig();
    const report = await scan(c);
    expect(exitCodeFor(report)).toBe(0);
    const saved = JSON.parse(readFileSync(join(c.configDir, ".leakproof", "findings.json"), "utf8"));
    expect(saved.findings).toEqual([]);
    expect(saved.units).toBe(6);
  });

  it("a Kane error is listed in errors, not findings, and exits 2", async () => {
    useFakeKane({ ...all("pass", 0), [KEYS.cookies]: { fixture: "infra", exit: 1 } });
    const report = await scan(shopConfig());
    expect(report.findings).toEqual([]);
    expect(report.errors.map((e) => e.unit)).toEqual(["checkout:cookies"]);
    expect(exitCodeFor(report)).toBe(2);
  });

  it("--only runs just that check", async () => {
    const log = useFakeKane(all("pass", 0));
    await scan(shopConfig(), { only: "cookies" });
    expect(kaneCalls(log)).toHaveLength(1);
  });

  it("--flow runs just that flow", async () => {
    const log = useFakeKane(all("pass", 0));
    await scan(shopConfig(), { flow: "checkout" });
    expect(kaneCalls(log)).toHaveLength(3);
  });

  it("reports each unit as it finishes and sums credits", async () => {
    useFakeKane(all("fail", 1));
    const seen: string[] = [];
    const report = await scan(shopConfig(), { onResult: (u) => seen.push(u.unit) });
    expect(seen.sort()).toEqual(["add-to-cart:console", "checkout:cookies", "checkout:env-leak", "checkout:storage", "home:network", "home:vitals"]);
    expect(report.credits).toBeGreaterThan(0);
  });

  it("rejects an unknown --flow with the valid names", async () => {
    useFakeKane(all("pass", 0));
    await expect(scan(shopConfig(), { flow: "nope" })).rejects.toThrow(/home, add-to-cart, checkout/);
  });
});
