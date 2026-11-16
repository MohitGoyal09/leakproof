# Demo video script (target 3:30–3:45)

What the research found:
- Past Kane winners ran 1:46–2:54.
- The strongest current entries open on "it looks fine, but…".
- Most entrants show one bug at a time, give no total and keep a human in the loop.

We beat that with a visible count (6 → 0), real evidence for every leak, one fix that Kane rejects, and no human between the agent and Kane.

| Time | On screen | Voice over |
|---|---|---|
| 0:00–0:12 | Driftwood Supply home page, slow scroll. Cut to the sign-in, then the checkout. | "This shop passes every screenshot test. It's leaking six different ways, and none of them show up on screen." |
| 0:12–0:30 | Title card "Leakproof". Then one line: `scan → Claude Code fixes → Kane proves`. | "Leakproof walks your app's real flows in a real browser with Kane CLI, hands every leak to Claude Code, and only counts a fix when Kane re-runs the check and it passes. No human in the loop." |
| 0:30–1:20 | Split screen: shop on the left, terminal running `npx leakproof scan` on the right. LEAK rows appear one by one. Hold on each for a beat. | Name each as it lands: "a 500 behind a fine-looking page… a TypeError when you add to cart… the session cookie readable by any script… a live key in localStorage… production calling a staging server… a page that takes 1.5 seconds to send its first byte." |
| 1:20–1:45 | Open `.leakproof/report.html`. The giant red 6. Scroll Exhibit A: Kane's raw HAR line, the screenshot, the Test Manager link. | "Every leak is a Kane verdict with its evidence: the network line, the console error, the screenshot of the failing step." |
| 1:45–2:55 | Terminal running `npx leakproof fix` (sped up 8x, with "8x" on screen). Exhibit headers, attempts, FIXED. Pause on the rejected attempt, if it happens, or on a STILL LEAKING retry. Cut in a `git log` showing one commit per fix. | "Claude Code gets the leak, Kane's evidence and three rules. Kane re-runs the same check after every edit. Here Kane said no, so Leakproof reverted and tried again with Kane's new evidence. Every passing fix becomes its own commit." |
| 2:55–3:20 | Report after fix: 6 → 0 in red and green. Then the same shop pages, identical on screen. | "Six to zero. The shop looks exactly the same, and now it's actually sealed." |
| 3:20–3:40 | README quick start and the cost line. End card: repo URL, "Verified with Kane CLI". | "It works on any web app with a few lines of YAML. About 20 Kane credits per check. Leakproof: proof, not promises." |

## Checklist for recording

- Record the real run, then speed up the waiting parts and label them. Say "unedited, sped up" in the description.
- Show the terminal at 120 columns or more so rows don't truncate. Font size 18+.
- Before recording, run `bash scripts/demo.sh control` once to show the fixed shop scores 0 (the false-positive control). Optional 5-second cut.
- Add YouTube chapters: 0:00 The lie · 0:30 Scan · 1:20 Evidence · 1:45 Fix loop · 2:55 Result · 3:20 Try it.

## Launch posts (2 required)

- **X:** "Your AI agent says the app works. The page renders fine. Leakproof found 6 leaks it couldn't see: an HttpOnly-less session cookie, a live key in localStorage, a hidden 500, a staging call… Claude Code fixed them, Kane CLI proved every fix. 6 → 0. [video] [repo] #KaneCLIHackDay"
- **LinkedIn / Hacker News (Show HN):** "Show HN: Leakproof – find the leaks a screenshot can't see, and make Kane prove every AI fix". Two short paragraphs on the problem (agents verify how a page looks, not what it leaks), how it works, and the 6 → 0 demo with real evidence. Link the repo and the video.
