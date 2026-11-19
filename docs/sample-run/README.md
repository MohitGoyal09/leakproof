# Sample run

A real `bash scripts/demo.sh fix` run on 20 Nov 2026: Kane CLI 0.10.4, Claude Code with Opus 5.5 as the fixer, on the demo shop with no hint comments in its code.

Result: **6 → 0 leaks, 6 fixes verified by Kane re-runs, 248 credits, 17m 35s.**

| File | What it is |
|---|---|
| [terminal.txt](terminal.txt) | The terminal output of the run |
| [report.html](report.html) | The before/after report, with a screenshot of each failing step from Kane's evidence pack (download it and open it in a browser) |
| [findings.json](findings.json) | The final re-scan: every check passed |
| [commits.txt](commits.txt) | The fix branch, one commit per proven fix |
| [fixes.patch](fixes.patch) | Every change the agent made |

The report links to each Kane run on the TestMu AI test manager.
