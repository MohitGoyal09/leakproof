# Sample run

Real runs on 21 Nov 2026 with Kane CLI 0.10.4, on the demo shop with no hint comments in its code. The fixer was Claude Code (Opus 5.5), run headless with no subagents.

**Fix run: 6 → 0 leaks, 6 fixes verified by Kane re-runs, 332 credits, 18m 38s.** Kane rejected one fix: the agent's first cookie fix still left the cookie without `Secure`, Kane's re-run failed, the edit was reverted, and Kane's verdict went back to the agent, whose second attempt passed. All 332 credits are Kane runs: the first scan, 7 re-runs and the final re-scan.

| File | What it is |
|---|---|
| [terminal.txt](terminal.txt) | Terminal output of the fix run |
| [report.html](report.html) | Before/after report. Each exhibit has Kane's evidence, the screenshot of the failing step, the failing Kane run and the Kane run that proves the fix. Download it and open it in a browser. |
| [prompts/](prompts/) | The exact prompt Claude Code got for each leak: Kane's evidence, diagnosis and suggestion, fenced as untrusted data |
| [commits.txt](commits.txt) | The fix branch: one commit per proven fix |
| [fixes.patch](fixes.patch) | Every change the agent made |
| [findings.json](findings.json) | The final re-scan: every check passed |
| [scan.txt](scan.txt) | A separate scan of the leaky shop: 6 leaks, 167 credits, 3m 25s |
| [control.txt](control.txt) | Two scans of the shop fixed by hand (`examples/shop.fixed.patch`) |

## Reviewing the fixes

Five fixes passed on the first attempt. The cookie fix needed two: see [prompts/checkout__cookies.2.txt](prompts/checkout__cookies.2.txt), which starts with Kane's verdict on the first attempt.

| Leak | What the agent changed | Root cause removed? |
|---|---|---|
| Hidden server error | The recommendations route returns two products instead of a 500 | Yes for the demo, which has no recommendation service. In a real app this hides a missing service; the agent's comment says so. |
| Slow requests | Removed the planted 3 s and 1.5 s delays | Yes. The delays were the leak. |
| Console error | `analytics?.track(...)` | Partly. The shop loads no analytics script, so the call no longer throws, but events are not tracked either. |
| Cookie flags | Session cookie set with `httpOnly: true, secure: true`, on the second attempt (Kane rejected the first) | Yes for the cookie. The login response still returns the token in its JSON body; the storage fix below stops the page from keeping it. |
| Secrets in storage | The login page no longer writes the token and the live key to `localStorage` | Yes |
| Environment leak | Telemetry posts to the same origin instead of the staging host | Yes |

## Control runs

The shop fixed by hand was scanned twice. One scan reported 0 leaks. The other reported 1 leak on the cookie check, with a generic verdict, although the hand fix sets `httpOnly: true, secure: true`. Kane is non-deterministic, so a single run can raise a false alarm.
