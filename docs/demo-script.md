# Demo video script (target 3:30–3:45)

What the research found:
- Past Kane winners ran 1:46–2:54.
- The strongest current entries open on "it looks fine, but…".
- Most entrants show one bug at a time, give no total and keep a human in the loop.

We beat that with a visible count (6 → 0), real evidence for every leak, Kane's verdict going straight back to the agent, and no human between the agent and Kane.

| Time | On screen | Voice over |
|---|---|---|
| 0:00–0:12 | Driftwood Supply home page, slow scroll. Cut to the sign-in, then the checkout. | "This shop passes every screenshot test. It's leaking six different ways, and none of them show up on screen." |
| 0:12–0:30 | Title card "Leakproof". Then one line: `scan → Claude Code fixes → Kane proves`. | "Leakproof walks your app's real flows in a real browser with Kane CLI, hands every leak to Claude Code, and only counts a fix when Kane re-runs the check and it passes. No human in the loop." |
| 0:30–1:20 | Split screen: shop on the left, terminal running `npx leakproof scan` on the right. LEAK rows appear one by one. Hold on each for a beat. | Name each as it lands: "a 500 behind a fine-looking page… a TypeError when you add to cart… the session cookie readable by any script… a live key in localStorage… production calling a staging server… a page that takes 1.5 seconds to send its first byte." |
| 1:20–1:45 | Open `.leakproof/report.html`. The giant red 6. Scroll Exhibit A: Kane's raw HAR line, the screenshot, the Test Manager link. | "Every leak is a Kane verdict with its evidence: the network line, the console error, the screenshot of the failing step." |
| 1:45–2:55 | Terminal running `npx leakproof fix` (sped up 8x, with "8x" on screen). Exhibit headers, attempts, FIXED. Hold 5 seconds on the real prompt the agent gets (`What Kane saw:`, `Kane's diagnosis:`). If the run has a retry, pause on it; never stage one. Cut in a `git log` showing one commit per fix. | "Claude Code gets the leak and Kane's evidence. After every edit, Kane re-runs the same check. A pass becomes its own commit. A fail is reverted, and Kane's new verdict goes back to the agent for the next try." |
| 2:55–3:20 | Report after fix: 6 → 0 in red and green. Then 5 seconds of `bash scripts/demo.sh control`: a hand-fixed shop scores 0. | "Six to zero. And on a shop fixed by hand, Leakproof reports nothing, so it is not inventing leaks." |
| 3:20–3:40 | README quick start and the cost line. End card: repo URL, "Verified with Kane CLI". | "It works on any web app with a few lines of YAML. About 20 Kane credits per check. Leakproof: proof, not promises." |

## Checklist for recording

- Record the real run, then speed up the waiting parts and label them. Say "unedited, sped up" in the description.
- Show the terminal at 120 columns or more so rows don't truncate. Font size 18+.
- Run `bash scripts/demo.sh control` and record it. The 0-leak control is required in the video (2:55–3:20).
- Say the real numbers on screen: credits and minutes from the run you recorded.
- Add YouTube chapters: 0:00 The lie · 0:30 Scan · 1:20 Evidence · 1:45 Fix loop · 2:55 Result · 3:20 Try it.

## Launch posts (2 required, post before 19 Nov 23:59 IST)

Rules: at least 2 different public posts on Hacker News, X, Reddit or LinkedIn. Tag: #KaneCLIHackDay. Replace `[video]` with the YouTube link.

### Post 1: X (short, one link, no em dashes)

```
Coding agents check how a page looks. Not what it leaks.

Leakproof: Kane CLI finds the leaks, Claude Code fixes them, and a fix counts only when Kane's re-run passes.

Demo shop: 6 leaks → 0.

github.com/MohitGoyal09/leakproof
#KaneCLIHackDay
```

Optional reply: `Leaks it checks: cookie flags, secrets in localStorage, hidden 500s, console errors, staging calls, slow requests.`

### Post 2: LinkedIn

```
My AI coding agent told me the shop was done. The page looked perfect.

It was leaking 6 ways. The session cookie could be read by any script. A login token and a live payment key sat in localStorage. The recommendations API returned 500 behind a fallback, so nobody saw it. Add to cart threw an error. Checkout still called a staging server. The home page took 1.5 seconds before the first byte.

None of this shows up in a screenshot, so an agent that "checks its work" by looking at the page misses all of it.

So I built Leakproof for the #KaneCLIHackDay hackathon:
1. Kane CLI walks your real user flows in a real browser and checks cookies, storage, network, console, hosts and timings.
2. Each leak goes to Claude Code with Kane's evidence (the HAR line, the console error, the screenshot).
3. A fix counts only when Kane re-runs the same check and it passes. Then a full re-scan catches regressions.

Real run on the demo shop: 6 leaks → 0, each fix proven by Kane, 207 credits, 16 minutes. On a hand-fixed copy it reports 0, so it does not invent leaks.

Demo: [video]
Code (MIT): https://github.com/MohitGoyal09/leakproof
```

### Optional post 3: Hacker News (Show HN)

Title: `Show HN: Leakproof – find the leaks a screenshot can't see, and make Kane prove every AI fix`
URL: `https://github.com/MohitGoyal09/leakproof`
First comment: the LinkedIn text without the hashtag, plus "Happy to answer questions about how the checks are phrased for Kane."
