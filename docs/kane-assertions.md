# Kane assertion spike (17 Nov 2026)

Kane CLI 0.10.4, model v16-alpha, against `examples/shop` (production build on :3000). The spike runner is `spike/run-spike.mjs`.

| Unit | Leaky shop | Fixed shop |
|---|---|---|
| home:network | failed (assertion_error) | passed |
| home:vitals | failed (assertion_error) | passed |
| add-to-cart:console | failed (assertion_error) | passed |
| checkout:cookies | failed (assertion_error) | passed (1st try was infra_error.screenshot_failed, retry passed) |
| checkout:storage | failed (assertion_error) | passed |
| checkout:env-leak | failed (assertion_error) | passed |

## Final assertion wording (Task 4 uses these verbatim)

- network: `assert that no network request in this step returned a status of 500 or higher.`
- console: `assert that there is no console message at level 'error' other than 'Failed to load resource' messages.` (The exclusion is needed: a 5xx also logs "Failed to load resource", which belongs to the network check.)
- cookies: `assert that no cookies are set without the HttpOnly flag. Then assert that no cookies are set without the Secure flag.`
- storage: `assert that no localStorage key contains 'token', 'secret' or 'api_key'. Then assert that no localStorage value starts with 'sk_live_', 'sk_test_' or 'eyJ'.`
- env-leak: `assert that no network request in this step went to a host, other than {appHost}, that contains 'staging', 'localhost', '127.0.0.1', 'dev.' or 'internal'.`
- vitals: `assert that every network request of type document, image, fetch or xhr in this step finished in under {slowMs} ms.`

Each is placed as `In this same step, <assertion>` after the step's action.

## What did not work

- "store X as 'offender'" inside an assertion step: Kane ignored it (`final_state` came back empty). The offender comes from the evidence pack instead.
- Web-vitals assertions (LCP/CLS/TTFB): Kane measured after a client-side navigation (TTFB 2.6 ms against a real 1.5 s, and LCP 24 ms with a 3 s hero image), so the leak was missed. Replaced by network timing.
- One sentence with three conditions: Kane checked only one of them. Use one condition per sentence.

## Classifying a run (do not trust the exit code alone)

An infra crash (`TargetClosedError`) also exits 1. Use `run_end.reason_code`:
- `success.*` means passed (result_code 100).
- `assertion_error.*` means a finding (result_code 7xx, for example 740 confirmed_product_bug or 710 final_verification).
- Anything else (`infra_error.*`, result_code 5xx) means an error. Retry once.

`run_end.verdict` (on failures) carries `bug_title`, `root_cause`, `suggestion`, `one_liner`, `confidence`, `confirmed` and `culprit_step`. Use these in the agent prompt and the report.

## Other fields and paths

- `run_end.credits_consumed`: credits for the run. Observed 6.8–30.3, about 20 on average.
- Duration: 50–107 s per run.
- `run_end.test_url`: the Test Manager share link.
- Evidence pack: `<session_dir>/evidence/<uuid>.evidence` is a zip (stored). Inside `tests/<test-slug>/`:
  - `logs/0-network.har`: HAR for the run, with status and timings. Use it to name the 5xx path, the slow URL and its duration, and the leaked host.
  - `logs/0-console.ndjson`: console messages.
  - `steps/<n>-0-<n>/screenshot.jpg` and `step.json`, with `steps/<n>/failure.yaml` on the failing step.
  - Top level: `failure.yaml`, `run.yaml`.
- `session_dir` is `run_dir` minus `/runs/0`.
- Variables file format: `{"NAME": {"value": "...", "secret": true}}`. `{{NAME}}` in the objective is replaced. Verified: the sign-in succeeded with `{{SHOP_USER}}`/`{{SHOP_PASS}}`.

## Budget

The spike used about 372 credits (11,200 → 10,828). One full scan of the demo (6 units) costs about 120 credits.
