# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Inferred (the user skipped the interview): web developers who use an AI coding agent and want proof that its work is safe, plus the KaneCLI hackathon judges (TestMu AI engineers) who watch a 3–5 minute demo and may run the tool themselves. They read the report right after a scan or fix, at a desk, often while recording or sharing their screen.

## Product Purpose
Leakproof finds the leaks a screenshot cannot see: insecure cookies, secrets in browser storage, hidden server errors, console errors, staging hosts in production code, and slow requests. Kane CLI walks the app's real flows in a real browser. Claude Code fixes each leak, and Kane re-runs the same check to prove the fix. Success means a team trusts the "0 leaks" verdict because every line has evidence behind it.

## Positioning
Leakproof does not trust the agent's word. Every finding and every fix is a Kane verdict with its own evidence pack: the HAR line, the console error, the failing step's screenshot and a Test Manager link.

## Operating Context
A CLI (`leakproof scan`, `leakproof fix`) run in a repo. It writes `.leakproof/report.html` and `findings.json`. The report is opened in a browser and often filmed.

## Capabilities and Constraints
- Six checks: cookies, storage, network, console, env-leak, vitals (slow requests).
- The report is one HTML file. It must never contain secret values.
- Kane credits are spent per run, and the report shows the total.

## Brand Commitments
Name: Leakproof. Everything else is open.

## Evidence on Hand
Real Kane runs against the demo shop (`examples/shop`). No customers, testimonials or benchmarks exist, so none may be invented.

## Product Principles
- Proof over claims: nothing is "fixed" until Kane says so.
- Show the raw evidence next to every verdict.
- Work on any web app with a short YAML file.
