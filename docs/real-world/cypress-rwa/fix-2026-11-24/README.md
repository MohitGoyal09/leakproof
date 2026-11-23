# Fix run on 24 Nov 2026: 4 → 0, with confirmed verdicts

`bash scripts/real-world.sh fix` on cypress-io/cypress-realworld-app (same pinned commit and config as the first run),
Leakproof at commit `2bc8b3a`, Claude Code (Opus 5.5) as the agent. Confirm was on: every failed scan check ran twice
before it counted, and every fix had to pass Kane twice before it was committed.

**4 → 0 leaks · 4 fixes verified by Kane · 1,058 credits · 36 min 22 s.** No Kane verdict was split, and every fix
passed on the first attempt, so no lesson was a rejection ([lessons.json](lessons.json) holds 4 proven fixes).

| | |
|---|---|
| [terminal.txt](terminal.txt) | the full run as printed |
| [report.html](report.html) | each leak, its fix and the Kane run that proves it |
| [prompts/](prompts/) | what the agent got, with Kane's evidence |
| [fixes.patch](fixes.patch), [commits.txt](commits.txt) | the agent's edits, one commit per proven fix |

## The fixes, reviewed by hand

| Leak | Fix | Our view |
|---|---|---|
| Cookie flags (sign-in) | `backend/app.ts`: session cookie `httpOnly: true, secure: true`, plus a shim that marks localhost requests as secure so express-session sends the cookie over plain-http localhost | Real for the flags. The shim only matters on localhost; in production behind TLS the request is already secure. |
| Secrets in storage (sign-in) | `src/machines/authMachine.ts`: stores only the state value and context, with the user's `password` field removed, instead of the whole state-machine object; renames the key `authState` → `userSessionState`; updates the one Cypress test helper that read the old key | **Half real.** Storing less is a real improvement: the whole state object can carry the login event, which includes the password. The rename, though, mainly gets past the check's `auth` key word (the agent's own comment says so); the signed-in user's profile is still in `localStorage`. |
| Console errors (sign-in) | `SvgCypressLogo.tsx`: `stop-color` → `stopColor`, `stop-opacity` → `stopOpacity` | Real: the React warnings are gone because the attributes are now valid. |
| Console errors (pay), found by the re-scan | `TransactionCreateStepTwo.tsx`: the amount field's custom input now forwards its ref with `React.forwardRef` | Real: the warning was hidden behind the first one, and the re-scan caught it. |

The storage fix is the honest limit of a check written as plain-English rules: an agent can satisfy the wording.
Kane proved that the check passes; a person still has to read the commit.
