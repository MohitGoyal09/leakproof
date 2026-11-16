// Spike: run one Kane objective per (flow, check) against the demo shop.
// Usage: node spike/run-spike.mjs <leaky|fixed> [unit ...]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const U = "http://localhost:3000";
const A = {
  network: "In this same step, assert that no network request in this step returned a status of 500 or higher.",
  vitals: "In this same step, assert that every network request of type document, image, fetch or xhr in this step finished in under 1000 ms.",
  console: "In this same step, assert that there is no console message at level 'error' other than 'Failed to load resource' messages.",
  cookies: "In this same step, assert that no cookies are set without the HttpOnly flag. Then assert that no cookies are set without the Secure flag.",
  storage: "In this same step, assert that no localStorage key contains 'token', 'secret' or 'api_key'. Then assert that no localStorage value starts with 'sk_live_', 'sk_test_' or 'eyJ'.",
  env: "In this same step, assert that no network request in this step went to a host, other than localhost:3000, that contains 'staging', 'localhost', '127.0.0.1', 'dev.' or 'internal'.",
};
const LOGIN = `Open ${U}/login and sign in with username {{SHOP_USER}} and password {{SHOP_PASS}}.`;
const CHECKOUT = `Open ${U}/checkout and wait for the order summary to appear.`;
const OBJ = {
  "home__network": `1. Open ${U}/ and wait for the product list to appear. ${A.network}`,
  "home__vitals": `1. Open ${U}/ and wait for the product list to appear. ${A.vitals}`,
  "add-to-cart__console": `1. Open ${U}/. ${A.console}\n2. Click "Add to cart" on the first product and check the cart count shows 1. ${A.console}`,
  "checkout__cookies": `1. ${LOGIN}\n2. ${CHECKOUT} ${A.cookies}`,
  "checkout__storage": `1. ${LOGIN}\n2. ${CHECKOUT} ${A.storage}`,
  "checkout__env-leak": `1. ${LOGIN} ${A.env}\n2. ${CHECKOUT} ${A.env}`,
};

const [label, ...wanted] = process.argv.slice(2);
const units = wanted.length ? wanted : Object.keys(OBJ);
const out = join(here, "out", label);
mkdirSync(out, { recursive: true });
const vars = join(tmpdir(), `lp-spike-${process.pid}.json`);
writeFileSync(vars, JSON.stringify({ SHOP_USER: { value: "demo", secret: false }, SHOP_PASS: { value: "demo123", secret: true } }), { mode: 0o600 });

function run(u) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("kane-cli", ["run", OBJ[u], "--url", U, "--agent", "--headless", "--timeout", "240", "--variables-file", vars]);
    let so = "", se = "";
    p.stdout.on("data", (d) => (so += d));
    p.stderr.on("data", (d) => (se += d));
    p.on("close", (code) => {
      writeFileSync(join(out, `${u}.ndjson`), so);
      writeFileSync(join(out, `${u}.err`), se);
      const last = so.trim().split("\n").reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.type === "run_end");
      resolve({ u, code, secs: Math.round((Date.now() - t0) / 1000), status: last?.status, final: last?.final_state, credits: last?.credits_consumed, reason: (last?.reason || last?.summary || se.slice(-200) || "").slice(0, 200), runDir: last?.run_dir });
    });
  });
}

const results = [];
const queue = [...units];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) results.push(await run(queue.shift())); }));
rmSync(vars, { force: true });
for (const r of results.sort((a, b) => a.u.localeCompare(b.u))) console.log(JSON.stringify(r));
