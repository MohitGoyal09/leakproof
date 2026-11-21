# Leakproof on a real app: cypress-realworld-app

[cypress-io/cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app) is an MIT-licensed payment app (sign-in, contacts, payments, bank accounts) that Cypress built to teach testing. We did not write it, and nothing in it was planted. Run on 21 Nov 2026 at commit `0729f68` (develop, 7 Oct 2026), the way its README runs it (`yarn dev`), with Kane CLI 0.10.4 and Claude Code (Opus 5.5) as the fixer.

**Result: 3 → 0 leaks, 3 fixes verified by Kane re-runs, 752 credits, 24m 27s.** The first scan alone: 2 leaks, 214 credits, 10 minutes.

Reproduce:
```bash
bash scripts/real-world.sh scan    # clones the app at the pinned commit, installs it, scans
bash scripts/real-world.sh fix     # the same, then fixes and proves each leak
```
The config is [leakproof.yml](leakproof.yml). Its flows were written once from the app's own screens (sign in, send a payment, open notifications and bank accounts) before the first scan, and not changed afterwards. `vitals` is left out because `yarn dev` serves the app from a Vite dev server, so request timings would measure the dev server.

## Findings and verdicts

| # | Check | What Kane saw | Verdict | The agent's fix | Root cause removed? |
|---|---|---|---|---|---|
| A | Cookie flags (sign-in) | The session cookie is set without the `Secure` flag. Kane's own suggestion notes the app runs over plain http. | **Real, minor.** The app never sets `secure` for its express-session cookie, in any environment, so a deployment would send it over plain http too. | `cookie: { httpOnly: true, secure: true }`, plus a middleware that marks `localhost` requests as secure so express-session will set a `Secure` cookie over local http | **Half.** `secure: true` is the right change. The localhost middleware exists only so the check can pass over http; an upstream change should use `trust proxy` behind HTTPS instead. A fix shaped by the test: read the commits. |
| B | Console errors (all flows) | `Warning: Invalid DOM property stop-color. Did you mean stopColor?` from `SvgCypressLogo` | **Real, minor.** React logs it at error level on every page in development. | `stop-color` → `stopColor`, `stop-opacity` → `stopOpacity` | Yes |
| C | Console errors (pay) | `Function components cannot be given refs … NumberFormatCustom` | **Real, minor.** Hidden behind B: it appeared only after B was fixed, in the full re-scan, and went through the fix loop as a leak the first scan could not see. | `NumberFormatCustom` wrapped in `React.forwardRef` | Yes |

## What Leakproof missed here
- **The user's auth state in `localStorage`.** The app keeps `authState` (the signed-in user's state) in `localStorage`. The storage check looks for token-like keys and values (`token`, `secret`, `api_key`, `eyJ…`, `sk_live_…`), so it passed. A broader check would flag it.
- **The hard-coded session secret** (`secret: "session secret"` in `backend/app.ts`). No browser check can see a server-side secret.
- **No server errors, no environment leaks.** The app's own API on `localhost:3001` was correctly treated as the app's own host.

## Files
| File | What it is |
|---|---|
| [scan.txt](scan.txt) | The first scan |
| [terminal.txt](terminal.txt) | The fix run: scan, three fixes, re-scan, recheck pass, last scan |
| [report.html](report.html) | The report, with Kane's evidence and the Kane run that proves each fix |
| [prompts/](prompts/) | The prompt Claude Code got for each leak |
| [commits.txt](commits.txt), [fixes.patch](fixes.patch) | One commit per proven fix, and the full diff |
| [findings.json](findings.json) | The last scan: every check passed |
