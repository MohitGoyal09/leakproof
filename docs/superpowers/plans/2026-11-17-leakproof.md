# Leakproof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI that uses Kane CLI to find hidden leaks in a web app's flows, has Claude Code fix each one, and proves every fix with a Kane re-run.

**Architecture:**
- The config is turned into run units, one per (flow, check) pair. Each unit becomes one plain-English Kane objective.
- `kane-cli --agent` NDJSON is parsed into results, and failed results become findings.
- The fixer loop drives `claude -p` in a git repo, guards the protected files, re-runs the unit and commits on a pass.
- A Next.js demo shop with six planted leaks proves the loop end to end.

**Tech Stack:** TypeScript, Node 20+, ESM, `commander`, `yaml`, `zod`, `execa`, `picocolors`, Vitest. The demo app is Next.js 15 (App Router). External CLIs: `kane-cli` (npm `@testmuai/kane-cli`) and `claude`.

**Spec:** `docs/superpowers/specs/2026-11-17-leakproof-design.md`

## Global Constraints

- Node `>=20`. The package name is `leakproof`, `bin` is `leakproof` → `dist/cli.js`, and `"type": "module"`.
- Runtime dependencies are limited to `commander`, `yaml`, `zod`, `execa` and `picocolors`. Dev dependencies: `typescript`, `vitest`, `@types/node`.
- The six check ids are exactly `cookies`, `storage`, `network`, `console`, `env-leak` and `vitals`.
- Default vitals thresholds: LCP 2500 ms, CLS 0.1, TTFB 800 ms.
- Kane is always called as `kane-cli run <objective> --url <url> --agent --headless --timeout <s>`, with a per-run timeout of 180 s by default.
- Kane exit codes: 0 means passed, 1 means failed (a finding), 2 means error and 3 means timeout. Exit 2 and 3 are retried once, then reported as errors, never as findings.
- At most 4 Kane runs in parallel during a scan, and 1 at a time during fix.
- `leakproof scan` exits 0 when there are no findings, 1 when there are findings, and 2 on a config, Kane or app error.
- `fix`:
  - It refuses a dirty git tree.
  - It works on a new branch `leakproof/fix-<yyyyMMdd-HHmmss>`.
  - The agent may never change `leakproof.yml`. If it does, the attempt is rejected and reverted.
  - It allows at most 3 attempts per finding, and accepts a fix only on a Kane re-run with exit 0.
- Secrets:
  - Values of the `env` names are passed only through a temporary Kane `--variables-file` (mode 0600, deleted in `finally`).
  - Secret values never appear in objectives, prompts, the terminal, `findings.json` or `report.html`.
- App readiness: poll `url` until an HTTP 2xx, with a 60 s timeout and a 500 ms interval.
- Outputs go to `<configDir>/.leakproof/`: `findings.json`, `report.html` and `runs/`. `leakproof init` adds `.leakproof/` to `.gitignore`.
- Deviation from the spec: the spec also guards `.leakproof/` from the agent. Here that folder is gitignored and rewritten on every run, so an agent edit there has no effect, and only `leakproof.yml` is guarded.
- Test seams: the env var `LEAKPROOF_KANE_BIN` (default `kane-cli`) and `LEAKPROOF_CLAUDE_BIN` (default `claude`).
- Commits are authored by the human only. No `Co-Authored-By` or "Generated with" lines. Commit messages use the `<type>: <description>` format.
- License: MIT. The repo is public on GitHub.

## Review Focus

1. **`kane-cli` is not installed or not logged in.** Expect a one-line error with the install or `kane-cli login` hint and exit 2. A stack trace is wrong. The test is in Task 5.
2. **The app never becomes ready, or the `start` command crashes.** Expect an error that names the URL and the last 20 lines of the start command's output, and exit 2. The test is in Task 6.
3. **Kane is killed mid-run or prints no `run_end` line.** The result must be `error`, not a crash and not a pass. The test is in Task 5.
4. **`claude` is missing, crashes or times out during a fix.** The attempt is recorded as `error`, the changes are reverted, and the loop moves on to the next finding. The test is in Task 10.
5. **The config names an env var that is not set.** It must fail before any Kane run, naming the variable. The test is in Task 3. A related test: a secret value never appears in `report.html` (Task 9).

---

### Task 1: Demo shop with six planted leaks

**Files:**
- Create: `examples/shop/` (Next.js 15 App Router: `package.json`, `app/page.tsx`, `app/login/page.tsx`, `app/checkout/page.tsx`, `app/api/login/route.ts`, `app/api/recommendations/route.ts`, `app/api/hero/route.ts`, `app/api/collect/route.ts`, `public/hero.jpg`)
- Create: `examples/shop/leakproof.yml`
- Create: `examples/shop.fixed.patch` (a hand-made patch that fixes all six leaks; it is the false-positive control)
- Create: `package.json`, `.gitignore`, `LICENSE` (MIT) at the repo root

**Interfaces:**
- Produces: the shop on `http://localhost:3000`, with login `demo` / `demo123` read from `SHOP_USER` / `SHOP_PASS`, and the planted leaks below.

- [ ] **Step 1: `git init` in `~/Code/leakproof`.** Commit the existing `docs/`, then scaffold the shop with `npx create-next-app@15 examples/shop --ts --app --no-tailwind --eslint --use-npm`.
- [ ] **Step 2: Plant the six leaks**, one per check:
  - `cookies`: `POST /api/login` sets cookie `session` with `httpOnly: false`, no `secure`, and `sameSite: 'lax'`.
  - `storage`: after login, the login page runs `localStorage.setItem('auth_token', <a JWT-shaped string>)` and `localStorage.setItem('stripe_key', 'sk_live_demo123')`.
  - `network`: the home page client fetches `/api/recommendations`, which returns 500. The UI shows a "Popular picks" fallback, so the page looks fine.
  - `console`: "Add to cart" updates the cart count first, then calls `window.analytics.track(...)`, which is undefined and throws a TypeError.
  - `env-leak`: on mount, the checkout page calls `fetch('http://staging.localhost:3000/api/collect')`. Chrome resolves `*.localhost` to 127.0.0.1, so the request really happens.
  - `vitals`: the hero is a plain `<img src="/api/hero">` with no width or height. `/api/hero` sleeps 3000 ms, then streams `public/hero.jpg`. A promo banner is inserted above the products after 1500 ms, which causes layout shift.
- [ ] **Step 3: Write `examples/shop/leakproof.yml`.**

```yaml
url: http://localhost:3000
start: npm run dev
env: [SHOP_USER, SHOP_PASS]
checks:
  vitals: { lcp_ms: 2500, cls: 0.1, ttfb_ms: 800 }
flows:
  - name: home
    checks: [network, vitals]
    steps:
      - Open the home page and wait for the product list to appear
  - name: add-to-cart
    checks: [console]
    steps:
      - Open the home page
      - Click "Add to cart" on the first product and check the cart count shows 1
  - name: checkout
    checks: [cookies, storage, env-leak]
    steps:
      - Open /login and sign in with username {{SHOP_USER}} and password {{SHOP_PASS}}
      - Open /checkout and wait for the order summary to appear
```

- [ ] **Step 4: Make the hand fix on a scratch branch**, then save it with `git diff main > examples/shop.fixed.patch`. The fix covers HttpOnly, Secure and SameSite=Strict, removes the storage writes, makes recommendations return 200, guards `window.analytics`, removes the staging call, and uses a sized `<img>` with the banner space reserved and the delay removed. Return to `main`.
- [ ] **Step 5: Verify by hand.** `cd examples/shop && npm run dev`. In Chrome DevTools, check that each of the six leaks is visible. Apply the patch with `git apply examples/shop.fixed.patch`, check that all six are gone, then revert with `git apply -R`.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: demo shop with six planted leaks"`

### Task 2: Kane spike (gate: nothing below starts until this passes)

**Files:**
- Create: `spike/run-spike.sh`
- Create: `docs/kane-assertions.md` (the final wording of each assertion, the measured credits per run, and the confirmed screenshot path inside `run_dir`)

- [ ] **Step 1: Set up Kane.** You run `npm install -g @testmuai/kane-cli && kane-cli login` yourself, because login is interactive OAuth. Then record `kane-cli balance`.
- [ ] **Step 2: Write `spike/run-spike.sh`.** It runs the six objectives from Task 4's templates, filled in by hand, against the shop, with `--agent --headless --timeout 180`. It saves each run's last NDJSON line to `spike/out/<check>.json`.
- [ ] **Step 3: Run it against the leaky shop.** Expected: all six runs exit 1, and `final_state.offender` names the planted item. That means cookie `session`, key `auth_token` or `stripe_key`, path `/api/recommendations`, the TypeError text, host `staging.localhost`, and an LCP above 2500 or a CLS above 0.1.
- [ ] **Step 4: Apply `shop.fixed.patch` and run again.** Expected: all six exit 0. Revert the patch.
- [ ] **Step 5: Tune and record the results.** Reword any assertion that misfires and repeat Steps 3–4 until both pass. Record in `docs/kane-assertions.md`:
  - the final wording
  - credits per run (from the balance difference ÷ runs)
  - where the failing step's screenshot lives in `run_dir`
  - whether `{{var}}` substitution works with `--variables-file`

  If one run per (flow, check) costs more than 40 credits, note that grouping by flow is the fallback.
- [ ] **Step 6: Commit.** `git commit -m "chore: kane assertion spike results"`

### Task 3: Package scaffold, types and config loader

**Files:**
- Create: `package.json` (root becomes the `leakproof` package), `tsconfig.json`, `vitest.config.ts`
- Create: `src/types.ts`, `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces in `src/types.ts`:

```ts
export type CheckId = 'cookies' | 'storage' | 'network' | 'console' | 'env-leak' | 'vitals';
export interface Step { do: string; checks?: CheckId[] }
export interface Flow { name: string; checks: CheckId[]; steps: Step[] }
export interface Vitals { lcpMs: number; cls: number; ttfbMs: number }
export interface Config { url: string; start?: string; env: string[]; vitals: Vitals; flows: Flow[]; configDir: string; configPath: string }
export interface RunUnit { id: string; flow: string; check: CheckId; objective: string }
export interface KaneResult { status: 'passed' | 'failed' | 'error' | 'timeout'; exitCode: number; summary: string; reason?: string; finalState: Record<string, string>; runDir?: string; testUrl?: string; failedStepIndex?: number }
export interface Finding { id: string; check: CheckId; flow: string; assertion: string; offender?: string; reason: string; summary: string; runDir?: string; testUrl?: string; screenshot?: string }
export interface FixAttempt { attempt: number; files: string[]; verdict: 'fixed' | 'still-failing' | 'rejected' | 'error'; note?: string }
export interface FindingOutcome { finding: Finding; attempts: FixAttempt[]; fixed: boolean }
export interface ScanReport { startedAt: string; url: string; units: number; findings: Finding[]; errors: { unit: string; message: string }[] }
export interface FullReport { before: ScanReport; outcomes?: FindingOutcome[]; after?: ScanReport }
```

- Produces in `src/config.ts`: `loadConfig(path: string, env?: NodeJS.ProcessEnv): Config` and `class ConfigError extends Error`. String steps are normalised to `{ do }`. YAML `lcp_ms`/`ttfb_ms` map to `lcpMs`/`ttfbMs`, with the defaults from Global Constraints.

- [ ] **Step 1: Write failing tests** in `test/config.test.ts`:
  - `loads the shop example`: `loadConfig('examples/shop/leakproof.yml', {SHOP_USER:'d', SHOP_PASS:'p'})` gives 3 flows, `flows[2].checks` equals `['cookies','storage','env-leak']`, and `vitals` equals `{lcpMs:2500, cls:0.1, ttfbMs:800}`.
  - `normalises string steps`: `flows[0].steps[0]` equals `{ do: 'Open the home page and wait for the product list to appear' }`.
  - `rejects unknown check`: a flow with `checks: [xss]` throws a `ConfigError` whose message contains `flows[0].checks[0]`.
  - `fails fast on missing env var` (Review Focus 5): without `SHOP_PASS`, it throws a `ConfigError` containing `SHOP_PASS`.
  - `rejects non-http url`: `url: ftp://x` throws a `ConfigError` containing `url`.
- [ ] **Step 2: Run** `npx vitest run test/config.test.ts`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement `loadConfig`** with a `zod` schema. Map the zod issue path to a `flows[0].checks[0]` style string in the error.
- [ ] **Step 4: Run** `npx vitest run test/config.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: config schema and loader"`

### Task 4: Check pack and objective builder

**Files:**
- Create: `src/checks.ts`, `src/objective.ts`
- Test: `test/objective.test.ts`

**Interfaces:**
- Consumes: `Config`, `Flow`, `CheckId`, `RunUnit` (Task 3).
- Produces:
  - `STEP_SCOPED: CheckId[] = ['network','console','env-leak']`
  - `STATE_SCOPED: CheckId[] = ['cookies','storage','vitals']`
  - `assertionFor(check: CheckId, ctx: { origin: string; vitals: Vitals }): string`
  - `buildUnits(config: Config): RunUnit[]`, where unit id is `` `${flow}:${check}` ``

- [ ] **Step 1: Write failing tests:**
  - `one unit per flow and check`: the shop config gives 6 units with ids `home:network`, `home:vitals`, `add-to-cart:console`, `checkout:cookies`, `checkout:storage`, `checkout:env-leak`.
  - `step-scoped check goes on every step when no step names it`: the `add-to-cart:console` objective contains the console assertion twice, once after each numbered step.
  - `state-scoped check goes on the last step`: the `checkout:cookies` objective contains the cookie assertion once, after step 2.
  - `explicit step placement wins`: a flow whose step 1 is `{do:'x', checks:['network']}` gets the network assertion only after step 1.
  - `env-leak excludes the app origin`: the assertion contains `http://localhost:3000` as the allowed origin.
  - `vitals uses thresholds`: the assertion contains `2500`, `0.1` and `800`.
  - `asks Kane to store the offender`: every assertion contains `store` and `'offender'` (vitals stores `'lcp'`, `'cls'` and `'ttfb'`).
- [ ] **Step 2: Run** `npx vitest run test/objective.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use the assertion wording verbatim from `docs/kane-assertions.md` (Task 2).
  - Objective format: one numbered line per step, `N. <do>.`, followed by ` In this same step, <assertion>.` for each check placed on that step.
  - Keep `{{VAR}}` placeholders as they are, because Kane substitutes them from the variables file.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: check pack and objective builder"`

### Task 5: Kane runner, NDJSON parser and pool

**Files:**
- Create: `src/kane.ts`, `src/pool.ts`
- Create: `test/fixtures/fake-kane.mjs`, `test/fixtures/ndjson/{pass,fail,error,no-run-end}.ndjson`
- Test: `test/kane.test.ts`, `test/pool.test.ts`

**Interfaces:**
- Consumes: `RunUnit`, `KaneResult`, `Config` (Task 3).
- Produces:
  - `parseNdjson(stdout: string, exitCode: number): KaneResult`
  - `runKane(unit: RunUnit, opts: { url: string; variables: Record<string, string>; timeoutS?: number; outDir: string }): Promise<KaneResult>`. It retries exit 2 or 3 once.
  - `class KaneNotFoundError extends Error`
  - `mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]>`
- `fake-kane.mjs` reads `FAKE_KANE_PLAN`, a JSON object `{ [objectiveSubstring]: { fixture: string, exit: number } }`. It prints the matching fixture and exits with the matching code. It appends each argv to `FAKE_KANE_LOG`.

- [ ] **Step 1: Write failing tests:**
  - `parses a passing run`: `pass.ndjson` with exit 0 gives `status 'passed'` and `runDir` set.
  - `parses a failed run with offender`: `fail.ndjson` with exit 1 gives `status 'failed'`, `finalState.offender === 'session'`, `reason` set, and `failedStepIndex === 1`, taken from the last `step_end` with `status:'failed'`.
  - `missing run_end is an error` (Review Focus 3): `no-run-end.ndjson` with exit 1 gives `status 'error'` and a summary containing `run_end`.
  - `ignores non-JSON lines`: noise lines mixed into stdout still parse.
  - `retries exit 2 once then reports error`: the fake plan exits 2 twice. Expect `status 'error'` and `FAKE_KANE_LOG` with 2 invocations.
  - `passes secrets only via variables file`: the argv logged has `--variables-file <path>` and does not contain the secret value. After the run, the file no longer exists.
  - `kane missing` (Review Focus 1): with `LEAKPROOF_KANE_BIN=/nonexistent`, it throws `KaneNotFoundError`, and the message contains `npm install -g @testmuai/kane-cli`.
  - `mapLimit never exceeds limit`: 10 tasks with limit 4 give a max concurrent count of 4, and the results keep the input order.
- [ ] **Step 2: Run** `npx vitest run test/kane.test.ts test/pool.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use `execa` with `reject: false`.
  - Map ENOENT to `KaneNotFoundError`.
  - Write the variables file with `fs.writeFile(path, json, { mode: 0o600 })` in `os.tmpdir()`, and delete it in `finally`.
  - Write raw stdout to `<outDir>/<unit.id with ':' replaced by '__'>.ndjson`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: kane runner with ndjson parsing"`

### Task 6: App lifecycle

**Files:**
- Create: `src/app.ts`
- Test: `test/app.test.ts`

**Interfaces:**
- Produces:
  - `waitForReady(url: string, timeoutMs?: number): Promise<void>` (default 60000, interval 500)
  - `startApp(config: Config): Promise<{ stop(): Promise<void>; output(): string }>`. If `config.start` is unset, it returns a no-op handle after `waitForReady`.
  - `class AppNotReadyError extends Error`

- [ ] **Step 1: Write failing tests:**
  - `resolves when server answers 200`: a `node:http` server on a random port resolves.
  - `times out with url in message` (Review Focus 2): with no server, a timeout of 1000 rejects with `AppNotReadyError`, whose message contains the URL.
  - `includes start output on failure`: `start: "node -e \"console.log('boom-marker');process.exit(1)\""` rejects, and the message contains `boom-marker`.
  - `stop kills the process tree`: after `stop()`, the port no longer answers.
- [ ] **Step 2: Run** `npx vitest run test/app.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Spawn with `execa` (`shell: true`, `cwd: configDir`, `detached: true`) and keep the last 20 output lines.
  - `stop` kills the process group with `process.kill(-pid)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: app start and readiness"`

### Task 7: Findings mapping

**Files:**
- Create: `src/findings.ts`
- Test: `test/findings.test.ts`

**Interfaces:**
- Consumes: `RunUnit`, `KaneResult`, `Finding` (Tasks 3–5).
- Produces:
  - `toFinding(unit: RunUnit, result: KaneResult): Finding | null`. It returns null unless `status === 'failed'`.
  - `findScreenshot(runDir: string, stepIndex?: number): string | undefined`. It uses the path pattern recorded in `docs/kane-assertions.md`, or falls back to the newest `.png` under `runDir`.
  - `dedupe(findings: Finding[]): Finding[]`. The key is `check + offender`, or `check + flow` when there is no offender.

- [ ] **Step 1: Write failing tests:**
  - `passed result gives no finding`.
  - `failed result maps fields`: `id === 'checkout:cookies'`, `offender === 'session'`, and `assertion` equals the unit's assertion text.
  - `error result gives no finding`: errors are not leaks.
  - `picks step screenshot`: a temp `runDir` holding two pngs returns the one for `stepIndex`.
  - `dedupe merges same offender across flows`: two `env-leak` findings with offender `staging.localhost` become 1.
- [ ] **Step 2: Run** `npx vitest run test/findings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: map kane results to findings"`

### Task 8: `scan` command and terminal output

**Files:**
- Create: `src/scan.ts`, `src/report/terminal.ts`, `src/cli.ts`
- Test: `test/scan.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces:
  - `scan(config: Config, opts?: { only?: CheckId; flow?: string; concurrency?: number; manageApp?: boolean }): Promise<ScanReport>`. When `manageApp` is not `false` (the default), it calls `startApp` first and stops the app at the end. It runs `buildUnits` filtered by the options, runs `mapLimit(…, 4, runKane)`, applies `toFinding` and `dedupe`, and writes `.leakproof/findings.json`.
  - `runUnit(config: Config, unitId: string): Promise<KaneResult>`, which the fixer uses. It never starts or stops the app.
  - CLI `leakproof scan [--config leakproof.yml] [--only <check>] [--flow <name>]` with the exit codes from Global Constraints.

- [ ] **Step 1: Write failing tests** (fake Kane plus a test HTTP server as the app, using `url` only and no `start`):
  - `six failing units give six findings and exit 1`.
  - `all passing gives exit 0 and empty findings.json`.
  - `kane error is listed in errors, not findings, and exit 2`.
  - `--only cookies runs one unit`: `FAKE_KANE_LOG` has exactly 1 line.
  - `findings.json written`: it parses as a `ScanReport` with `units === 6`.
- [ ] **Step 2: Run** `npx vitest run test/scan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `scan`, `runUnit`, the terminal table and the `commander` wiring.**
  - The terminal table has one row per unit: `flow`, `check`, `PASS`/`LEAK`/`ERROR`, and the offender.
  - Errors print one line plus their hint. They never print a stack trace unless `DEBUG=leakproof` is set.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: scan command"`

### Task 9: HTML report

**Files:**
- Create: `src/report/html.ts`
- Test: `test/html.test.ts`

**Interfaces:**
- Consumes: `FullReport` (Task 3).
- Produces:
  - `renderHtml(report: FullReport): string`. It returns a single self-contained file with inline CSS and no external requests.
  - `writeReport(configDir: string, report: FullReport): string`. It returns the path.
  - The CLI command `leakproof report` opens the last report.

- [ ] **Step 1: Write failing tests:**
  - `shows before and after counts`: a before report with 6 findings and an after report with 0 renders `6` and `0` in the scorecard.
  - `escapes page text`: an offender `<img src=x onerror=alert(1)>` appears only in escaped form.
  - `never contains secret values` (Review Focus 5): a report built from a run whose variables included `demo123` does not contain `demo123`.
  - `one card per outcome with attempts and verdict`.
  - `links evidence`: `testUrl` is rendered as `<a href>`, and the screenshot is rendered as a relative `<img>`.
- [ ] **Step 2: Run** `npx vitest run test/html.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with template strings and one `escapeHtml` helper. Use the design direction of a test-run report with pass and leak verdict chips.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: html report"`

### Task 10: Fixer loop

**Files:**
- Create: `src/git.ts`, `src/fixer.ts`
- Create: `test/fixtures/fake-claude.mjs`
- Test: `test/fixer.test.ts`

**Interfaces:**
- Consumes: `scan`, `runUnit` (Task 8), `waitForReady`, `startApp` (Task 6), `writeReport` (Task 9).
- Produces:
  - `git.ts`:
    - `isClean(dir)`
    - `changedFiles(dir): Promise<string[]>`, covering tracked and untracked files but not ignored ones
    - `revertAll(dir)`, which runs `git checkout -- . && git clean -fd`
    - `createBranch(dir, name)`
    - `commitAll(dir, message)`
  - `buildFixPrompt(finding: Finding, flow: Flow, last?: KaneResult): string`
  - `runAgent(dir: string, prompt: string, timeoutMs?: number): Promise<{ ok: boolean; note?: string }>`. It runs `claude -p <prompt> --permission-mode acceptEdits --output-format json` with a default timeout of 600000.
  - `fixAll(config: Config, opts?: { maxAttempts?: number }): Promise<FullReport>`
  - CLI `leakproof fix [--max-attempts 3] [--agent claude]`. Only `claude` is accepted until the stretch task adds `codex`.
- `fake-claude.mjs` reads `FAKE_CLAUDE_PLAN`, a JSON list of actions run one per call. The actions are `{write: {path, content}}`, `{exit: n}` or `{sleep: ms}`.

- [ ] **Step 1: Write failing tests.** Each uses a temp git repo plus fake Kane and fake Claude.
  - `refuses dirty tree`: an untracked file makes it throw, with a message containing `commit or stash`.
  - `fixed on first attempt`: Claude writes a file and the Kane re-run passes. Expect `verdict 'fixed'`, a new commit on a branch matching `^leakproof/fix-\d{8}-\d{6}$`, and a commit message starting with `fix: leakproof`.
  - `retries with feedback then gives up`: Kane fails 3 times. Expect 3 attempts all `still-failing`, `fixed === false`, a clean tree afterwards, and the 2nd prompt containing the 1st re-run's `reason`.
  - `rejects edits to leakproof.yml`: Claude writes `leakproof.yml`. Expect `verdict 'rejected'`, the file restored, and Kane not called for that attempt.
  - `agent crash or timeout is an error and loop continues` (Review Focus 4): attempt 1 is `{exit: 1}` and attempt 2 is `{sleep: 999999}` with `timeoutMs: 200`. Both come back `error`, the tree is clean, and the next finding is still processed.
  - `prompt contains evidence, not secrets`: the prompt includes the assertion, offender, reason and flow steps, and does not include the value of `SHOP_PASS`.
  - `final rescan populates after`: `report.after` is defined.
- [ ] **Step 2: Run** `npx vitest run test/fixer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `fixAll`** with this loop:

```
assert isClean → createBranch → app = startApp(config)   # stopped in finally
before = scan(config, { manageApp: false })
for each finding (sequential):
  last = undefined
  for attempt in 1..max:
    res = runAgent(dir, buildFixPrompt(finding, flow, last))
    if !res.ok → record 'error', revertAll, continue
    files = changedFiles(dir)
    if files is empty → record 'still-failing' (note "no changes"), continue
    if files includes 'leakproof.yml' → record 'rejected', revertAll, continue
    await waitForReady(config.url)
    r = runUnit(config, finding.id)
    if r.status === 'passed' → commitAll(`fix: leakproof ${finding.check} in ${finding.flow}`), record 'fixed', break
    record 'still-failing', last = r, revertAll
after = scan(config, { manageApp: false }); writeReport({before, outcomes, after})
```

  Prompt rules (fixed copy):
  - "Make the smallest code change that makes this check pass."
  - "Do not edit leakproof.yml or disable the check."
  - "Do not delete features the flow uses."

- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: fix loop with kane re-verification"`

### Task 11: `init`, README and package publish setup

**Files:**
- Create: `src/init.ts`, `README.md`
- Modify: `package.json` (`bin`, `files`, `prepublishOnly: tsc`), `src/cli.ts`
- Test: `test/init.test.ts`

**Interfaces:**
- Produces: `runInit(dir: string): { configPath: string; gitignoreUpdated: boolean }`. It refuses to overwrite an existing `leakproof.yml`.

- [ ] **Step 1: Write failing tests:**
  - `writes starter config that loads`: `loadConfig` passes on the written file when the env names are set.
  - `adds .leakproof/ to .gitignore once`: running it twice leaves the line in the file only once.
  - `refuses to overwrite`.
- [ ] **Step 2: Run** `npx vitest run test/init.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `runInit`.** Write the README with:
  - a one-line pitch
  - the before/after GIF slot
  - install and login steps (`npm i -g @testmuai/kane-cli`, `kane-cli login`)
  - `npx leakproof init / scan / fix`
  - the six checks table
  - how the loop works
  - the "Verified with Kane CLI" note
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit --pretty false`. Expected: all tests pass and there are no type errors.
- [ ] **Step 5: Commit.** `git commit -m "feat: init command and readme"`

### Task 12: End-to-end demo on the real shop

**Files:**
- Create: `scripts/demo.sh`
- Modify: `README.md` (paste the real numbers from the run)

- [ ] **Step 1: Write `scripts/demo.sh`.** It:
  - copies `examples/shop` to `$TMPDIR/leakproof-demo-shop`
  - runs `git init && git add -A && git commit -m init` there
  - runs `npm install --silent` and `npm run build` of the root package
  - exports `SHOP_USER=demo SHOP_PASS=demo123`
  - runs `node <root>/dist/cli.js scan`, then `fix`, from that folder
- [ ] **Step 2: Run the scan.** Run `bash scripts/demo.sh scan`. Expected: exit 1, and the table shows 6 LEAK rows (one per check) with the offenders from Task 2.
- [ ] **Step 3: Run the fix.** Run `bash scripts/demo.sh fix`. Expected: all 6 outcomes are `fixed` within 3 attempts, `after.findings` is empty, and `report.html` shows 6 → 0.
- [ ] **Step 4: Run the control.** On a fresh copy with `shop.fixed.patch` applied, run `scan`. Expected: exit 0 with zero findings (the false-positive control).
- [ ] **Step 5: Record and commit.** Record `kane-cli balance` before and after in the README, then `git commit -m "docs: real demo results"`.

### Stretch (only if Tasks 1–12 are done before 19 Nov 18:00 IST)

- `--agent codex` through `codex exec`, in `src/fixer.ts` `runAgent`.
- A Stop-hook adapter, `hooks/claude-stop.mjs` (about 30 lines). It runs `leakproof scan` and exits 2 with the finding summary on stderr when there are leaks.
