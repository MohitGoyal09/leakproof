# Leakproof design

Date: 2026-11-17. Deadline: 19 Nov 2026, 11:59 PM IST (KaneCLI Online Hackathon).

## Intent

Coding agents ship web apps that look right but leak in ways a screenshot cannot see. Leakproof uses Kane CLI to walk an app's key user flows in a real browser and check what is hidden: cookies, browser storage, network traffic, the console and page speed. Each leak goes to a coding agent with Kane's evidence. The agent fixes it, and Kane re-runs the same check to prove it is gone.

Hackathon fit:
- **Ships**: one command, real flows.
- **Verified**: Kane both finds each leak and proves each fix.
- **Closed loop**: every finding becomes the agent's next prompt, and every fix becomes Kane's next run.
- **Craft**: it works on any web app.

Field research on 17 Nov found 58 rival repos, and none uses Kane's DevTools checks.

## Goals

1. `leakproof scan` runs a fixed pack of checks over the flows in `leakproof.yml` through Kane CLI, then prints and saves a scorecard of findings with evidence.
2. `leakproof fix` runs scan, sends each finding to Claude Code in headless mode (`claude -p`) inside the target repo, re-runs only that check, and retries up to 3 times. It ends with one full re-scan to catch regressions.
3. A demo shop app with six planted leaks, one per check, so the demo goes from 6 findings to 0.
4. An HTML report showing before and after, each finding's Kane verdict, and links to the evidence (screenshots, run folder, Test Manager URL).

## Non-goals

- Automatic flow discovery with `kane-cli explore`. It runs on HyperExecute, costs credits and needs a project. Flows are written by hand in YAML.
- Mobile targets.
- A GitHub Action or CI mode. This is a stretch goal only.
- Agents other than Claude Code. A `--agent codex` flag using `codex exec` is a stretch goal only.

## Anti-goals (a failure even if it runs)

- **False positives on a healthy app.** Each check must pass on the fixed demo shop, and on one real public site we trust.
- **The agent "fixes" a leak by weakening the check.** The fixer must not edit `leakproof.yml` or anything under `.leakproof/`. Leakproof verifies this with `git diff --name-only` after each fix and rejects the attempt if those paths changed.
- **Claims without proof.** A finding counts as fixed only when Kane's re-run exits 0.

## Constraints

- **Time:** 2.5 days. The demo video and two public posts also need time.
- **Credits:** 10,000 free Kane credits (more are available on Slack). Keep the number of runs low. The demo needs about 6 flows x (scan + up to 3 re-runs).
- **Kane facts:**
  - `kane-cli run "<objective>" --url <u> --agent --headless --timeout <s>` writes NDJSON to stdout.
  - The last line is `run_end` with `status`, `summary`, `one_liner`, `reason`, `final_state`, `run_dir`, `session_dir` and `test_url`.
  - Exit codes: 0 pass, 1 fail, 2 error, 3 timeout.
  - Network and console capture reset every step, so an assertion must run in the same step as the action that causes the traffic. Cookies and localStorage are read when the assertion runs.
- **Repo rules:** a new public GitHub repo (created on or after 12 Nov), MIT license, a demo video on YouTube.

## Approaches considered

- **A. Leakproof drives the loop (chosen by you).** The CLI orchestrates scan, then fix, then re-verify, and calls the agent as a child process. One command, works with any agent, and clearly different from the 8 Stop-hook gate repos.
- **B. Claude Code drives the loop** (skill plus Stop hook). The tightest loop, but it is the crowded done-gate pattern, tied to one agent, and harder for judges to run.
- **C. A plus a Stop-hook adapter.** Deferred. Add it only if A is done early.

## Design

### Pieces

1. **Config (`leakproof.yml`)**
   - `url`, an optional `start` command, and `env` names for test credentials.
   - `flows`: each has a name and plain-English steps.
   - `checks`: which of the six checks are on, plus thresholds.
   - It is validated with a schema at load time. A bad config fails fast with the exact field named.
2. **Check pack.** Six checks, each a plain-English assertion template that is added to the flow:
   - `cookies`: the session cookie is HttpOnly, and no cookie lacks Secure or SameSite.
   - `storage`: no localStorage key or value looks like a token, API key or JWT.
   - `network`: no request in the flow returns a 5xx status, even when the page looks fine.
   - `console`: no console errors or uncaught exceptions during the flow.
   - `env-leak`: no request goes to `localhost`, a `staging`/`dev`/`internal` host, or a debug path that does not match the app's own origin.
   - `vitals`: LCP, CLS and TTFB are under thresholds (defaults: 2500 ms, 0.1, 800 ms).
3. **Runner.**
   - It builds one Kane objective per flow, with the check assertions placed in the step they belong to.
   - It runs `kane-cli` with `--agent --headless --timeout`, parses the NDJSON, and maps each failed assertion to a finding.
   - **Day 1 spike decides the granularity:** either one run per flow with all assertions, attributed from `step_end` and `run_end`, or one run per flow x check if attribution is unreliable. Runs go in parallel, 4 at a time.
4. **Finding.** Contains `id`, `check`, `flow`, `assertion`, Kane `reason` and `summary`, `run_dir`, `test_url`, plus the failing step's screenshot path and console or network excerpt read from the run folder.
5. **Fixer.**
   - Per finding, it runs `claude -p` in the target repo with a prompt containing the finding, the evidence, the flow steps, and the rule to make the smallest fix and not touch `leakproof.yml`.
   - It then re-runs Kane for that flow and check only. Up to 3 attempts, and the next attempt gets the new Kane result as feedback.
   - It records the agent's diff for each attempt.
6. **Report.**
   - A live terminal table while running.
   - `.leakproof/report.html`: a before/after scorecard and one card per finding with its verdict, attempts, diff summary and evidence links.
   - `.leakproof/findings.json`: the machine-readable version.
7. **Demo shop (`examples/shop`, Next.js).** Six planted leaks:
   - The session cookie is set without HttpOnly or Secure.
   - A JWT and a fake `sk_live_…` key are saved in localStorage.
   - `/api/recommendations` returns 500 while the UI shows a fallback.
   - "Add to cart" throws a console TypeError but still updates the cart.
   - The checkout page calls `http://staging.internal/…` analytics.
   - A huge unsized hero image plus a banner inserted late cause poor LCP and CLS.

### Commands

- `leakproof init`: writes a starter `leakproof.yml`.
- `leakproof scan [--only <check>] [--flow <name>]`: exit 0 means no leaks, 1 means leaks found, 2 means a Kane or config error.
- `leakproof fix [--max-attempts 3] [--agent claude]`
- `leakproof report`: opens the last HTML report.

### Tech

- TypeScript on Node 20, published to npm as `leakproof`, so `npx leakproof` works.
- Small dependencies only: `commander` for the CLI, `yaml` and `zod` for config, `execa` for child processes, `picocolors` for terminal output.
- Vitest for unit tests.
- The HTML report is one self-contained file from a template string, with no framework.

### Testing

- **Unit:** the NDJSON parser (pass, fail, error, timeout and malformed lines), config validation, objective building per check, finding mapping, the fixer's protected-path guard, and prompt building.
- **End to end:** `leakproof scan` against the demo shop finds exactly 6 findings, one per check. `leakproof fix` brings it to 0. A scan of the fixed shop reports 0 (the false-positive guard).

## Details settled after review

- **Kane supports all six checks natively.** Its docs list plain-English assertions over:
  - cookies (`http_only`, `secure`, `same_site`)
  - localStorage (keys and values)
  - network (`response_status`, `domain`, `url`)
  - console (`level`, `text`)
  - performance (LCP, CLS, INP, FCP, TTFB)

  No CDP or Playwright fallback is planned. The Day 1 spike proves each check fails on the planted leak and passes on the fixed code before anything else is built.
- **Where checks go in a flow.**
  - A step is either a string or `{do, checks}`. The `{do, checks}` form lets you place checks on that step.
  - If a step names no checks: `network`, `console` and `env-leak` are added to every step, because their capture resets each step. `cookies`, `storage` and `vitals` are added to the last step.
- **Demo size and credit budget.**
  - The demo shop has 3 flows: browse home, add to cart, and log in then check out. Together they carry all 6 checks.
  - The worst case is 3 scan runs + 6 findings x 3 attempts + 3 final runs = 24 Kane runs.
  - The spike measures credits per run with `kane-cli balance` before and after.
- **Flakiness.**
  - Only exit 1 creates a finding. Exit 2 or 3 is retried once, then reported as an error, not a leak.
  - A fix is accepted only when the targeted re-run exits 0. The final full re-scan catches regressions.
- **False-positive control.** The fixed demo shop is the control: a full scan of it must report 0. A public site is optional for the demo video and not a requirement.
- **Starting the app.**
  - If `start` is set, Leakproof spawns it and polls `url` until it answers HTTP 2xx (60 s timeout).
  - After each fix it waits for the URL to be ready again; the Next.js dev server reloads by itself.
  - If `start` is not set, the app is assumed to be already running.
- **Credentials.**
  - Names listed in `env` are read from the environment and written to a temporary Kane `--variables-file` (deleted after the run).
  - Objectives refer to them as `{{name}}`, so secrets never appear in objective text, prompts or the report.
- **Repo state.**
  - `fix` refuses to start on a dirty git tree, so each attempt's diff is exactly `git diff` and a failed attempt can be undone with `git checkout -- .`.
  - Findings are de-duplicated by check plus the offending item (cookie name, storage key, host, URL path).

## Left to the builder

File layout inside `src/`, exact prompt wording, terminal table styling, report styling, and the exact plain-English phrasing of each assertion (tuned during the Day 1 spike).
