# Design: Leakproof report

World: a materials test certificate from an independent lab. Plain paper, a ruled header block with the specimen (the app URL) and the date, numbered exhibits, a verdict stamp for each, and the raw readings printed in a fixed-width face beside them. It reads as evidence, not as a dashboard.

Scene: a developer at a desk right after a scan, often screen-sharing or recording, so the page is light and must read at video compression.

## Colour (Restrained, two semantic signals)
- `--paper` #fbfbf9: ground
- `--ink` #16181d: text and rules
- `--ink-2` #5a5f6b: secondary text (6.4:1 on paper)
- `--rule` #dcdcd6: hairlines
- `--leak` #b42318 on `--leak-wash` #fdecea: leak verdicts
- `--sealed` #146c43 on `--sealed-wash` #e5f3eb: fixed or passing verdicts
- `--warn` #8a5a00 on `--warn-wash` #fbf1dc: errors
Red and green are the only saturated colours, and they carry state only.

## Type
- Display and UI: Archivo (Google Fonts, `wdth` 62–125) with system sans as the fallback. Expanded weight 800 at width 112 for the verdict numerals and the title, normal width for text.
- Readings (HAR lines, console errors, URLs, file names): JetBrains Mono. It is used only for real data.
- Scale: 13 / 15 / 18 / 24 / 40 / 120 (verdict numerals). Tabular figures everywhere.

## Components
- Certificate header: a ruled block of label/value pairs (Specimen, Scanned, Checks, Kane credits).
- Verdict band: "6 → 0" numerals with words under them ("leaks before", "leaks after").
- Exhibit: a letter (A, B, …) as the reference, the check name, Kane's bug title, flow, a verdict stamp (LEAK, then FIXED or STILL LEAKING), the readings, why it matters, the attempts and the screenshot. Separated by rules, with no card shadows.
- Stamp: uppercase, letter-spaced 0.08em, 1.5px border in the state colour, 4px radius.

## Motion
None. It is a document.
