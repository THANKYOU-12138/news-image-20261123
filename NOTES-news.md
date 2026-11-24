# news-image-20261123 — build notes

## Mechanics (from the kit's RULES.txt / competition.yaml)

- Program/v1 entry: Node 22 `main.ts`, standard library only, no network,
  1 CPU / 512 MB / 60 s. It runs twice; both runs must write identical bytes
  to `/output/entry.png` (locally `MAKEFUN_OUTPUT_DIR` stands in for `/output`).
- Gate (pass/fail only, no fact check): whole PNG or JPEG, ≤ 1 MiB,
  ≤ 1024×1024 px.
- Ranking: AI vision judge (z-ai/glm-5.3-flash) in pairwise games
  (Bradley–Terry win rate; Swiss rounds + top-52 playoff). Criteria in order:
  (1) names its day and shows that day's specific, recognisable events —
  anything about a day before 13 Nov 2026 loses; (2) breadth across regions
  and fields; (3) readable from the image alone, short labels allowed,
  nothing false; (4) faithful, no hype; (5) clean craft, legible at ~300 px,
  no garbled text.
- The kit ships no news data; the entrant supplies the day's news. The starter
  was a copy-program holding a placeholder `entry.png`; it has been replaced
  by a program that draws the image from code (the starter `entry.png` was
  removed from the repo). Prizes: $20 / $12 / $6 / $2×7 / $1.20×40 = $100.

## What was built

A single `main.ts` (~640 lines, all authored in-session) containing:

- a hand-rolled rasteriser over a 1024×1024 RGB buffer (rects, thick
  Bresenham lines, circles, scanline triangles);
- a hand-authored 5×7 bitmap font (A–Z, 0–9, punctuation, `·`, `€`, `&`);
- text rendering with a screen-pixel "bold offset" (a second stamp shifted
  1–3 px) that thickens headline strokes without closing glyph counters —
  a full font-pixel bold was tried first and turned large type into blobs;
- a zlib-based PNG encoder (CRC32, IHDR/IDAT/IEND, filter-none scanlines);
- `compose()`: a newspaper front page for **Monday 23 November 2026**.

Page layout: masthead with the date at the largest size on the page; lead
panel (Huang reinstated at Nvidia, shares +33%, S&P 500 +4.8%, Nikkei −5%,
with a dip-and-surge chart icon); Benghazi sinking panel (ship + drone icon);
COP31 / Hormuz / Dymer panels; US House / Shenzhen summit / Nepal–Delhi
panels; a footer strip with the Women's World Cup 2031/2035 awards,
BepiColombo at Mercury, and the El Chapo Isidro capture. All eleven stories
from the research brief are depicted; no facts were invented or embellished.

## Verification (local)

- Runs clean under `node main.ts` (Node v24 here; only erasable TS syntax
  used, grader runs Node 22.23.4). Runtime well under 1 s per run.
- Output: PNG, 1024×1024, 8-bit RGB, **21,321 bytes** (cap 1,048,576).
- Determinism: two consecutive runs are byte-identical,
  sha256 `03d3fe21f060ed9c22fe6e27529fa1ac56f6b9d6d550da66f4e8499a8821cf70`.
- PNG integrity confirmed by an independent decode (inflate + parse) during
  the downscale check.
- Visual inspection at full size: every glyph and label legible, no garbled
  text, no overlaps (an early drone/tag collision and the over-bold type
  were found and fixed). At a 300 px downscale the date, masthead and all
  eight headlines remain legible.
- The kit states there is no local grade for this competition ("the server
  grades every entry"), and `check` needs the transcript bundle, so local
  verification above stands in for it; bundling/submission is the parent
  agent's step.

## Repo state

- Commits: `90b508e` starter (unmodified) → `a305021` drawing program →
  `b4e3c17` type-weight/drone/tag fixes → `de37dcb` COP31 tag fix →
  this notes file.
- Files: `main.ts`, `LICENSE` (starter's, OSI), `NOTES-news.md`, `.gitignore`
  (run-output dirs). No `entry.png` in the repo: the program draws it.
