# 009 — Mobile polish: space, tap states, controls, rows

Status: **Built 2026-07-28 — awaiting manual test.**

Four asks from BarkernotBob, all on the phone. Nothing on the desktop changes except
one padding bug that turned out to be the same bug as one of the four.

---

## 1. Cut the space around the video

Measured on a 390pt phone with the phone-layout harness (see the
`obsidian-mobile-css-harness` note) — 62px of the screen above and below the
picture was going nowhere:

| | before | after |
|---|---|---|
| top of the view → top of the video | 107px | 91px |
| of which: reserved status line | 22px | 0 |
| video → controls | 4px + gap | 6px |
| under the control row | 24px | 0 |

Three separate causes:

1. **The status line was a reserved row above the picture.** It is now
   absolutely positioned *inside* the media box, drawn across the top of the
   video. It still costs no layout — for a better reason than before, since it
   is out of the flow entirely. The z-index is load-bearing: the poster is
   created after it and would otherwise hide "Resolving stream…", the one
   message that matters.
2. **`padding: … var(--file-margins) …` is a four-value shorthand.**
   `--file-margins` is a *pair* (`--file-margins-y --file-margins-x`), so
   `padding: 6px var(--file-margins) 0` computed to `6px 8px 24px 0px` — the
   control row sat flush against the left edge of the screen and carried 24px
   of dead space underneath it. `--file-margins-x` is the single value that was
   wanted. The desktop pinned player had the identical bug
   (`8px 8px 24px 6px`), and is fixed with it.
3. **Obsidian's top spacing is header + 16px.** The 16px is the gap it leaves
   before a note's *text*. A video is not text; against the bottom of the
   header is where a player belongs.

## 2. The delete button, and the grey that followed your thumb

- **Row separators.** The list drew as floating rounded cards with nothing
  between them, so the delete column's rule had nothing to meet. Every phone
  row now carries a hairline, full-bleed, and the column stretches to it:
  measured flush at the top and 1px short at the bottom, which is the separator
  itself.
- **`align-self: stretch`, not `height: 100%`.** The row centres its children,
  so a percentage height was measured against a box that was only definite by
  accident.
- **56px wide, not a fifth of the screen.** Still a target twice the size of
  the icon in it; the ~16px goes to the title column (180px → 198px).
- **The grey is a hover state, and a phone has no pointer.** iOS applies
  `:hover` on tap and leaves it applied. Every hover rule in the stylesheet is
  now behind `@media (hover: hover) and (pointer: fine)`, plus
  `-webkit-tap-highlight-color: transparent` and neutralised `:focus`/`:active`
  on the icon buttons — the two states iOS adds by itself.

## 3. Controls that look like controls

Seven text buttons of seven different widths, left-packed against the margin
and wrapping onto a second line: it worked and it looked like a debug panel.

- **Symbols, not words**, on the phone only: `play`/`pause`, `rewind` and
  `fast-forward` (with a static "10" badge in the corner), `picture-in-picture`,
  `maximize`, `chevrons-up`/`chevrons-down`. An icon name an Obsidian build does
  not know renders nothing, so a button whose icon did not appear falls back to
  its old word rather than to an empty box.
- **One size for everything** — 40px squares, `--icon-size: 20px`, no borders —
  **except Play**, which is 48px, round, and in the accent colour, because it is
  the one you reach for.
- **A `1fr auto 1fr` grid**, so the transport is centred on the *screen* rather
  than on whatever is beside it. Measured dead centre at 390, 375 and 360pt.
- **PiP moved to the left group**, with the speed picker. Three buttons on the
  right and one on the left is wider than half a phone minus the transport, and
  a side cell that cannot fit its contents is a transport that is no longer in
  the middle. Two and two fits, on a 375pt screen too.
- Below 380pt everything comes down one size in a single step, rather than
  overflowing by degrees.

## 4. Rows that read as a list

The second line ran to seven segments — channel, age, views, Short, Watch
Later, Search, Watched — in a column about 180pt wide. It truncated mid-word,
every row broke in a different place, and a screen of them was noise.

On a phone it is now **two segments: who made it, and how old it is**. The
flags are not dropped, they are *shown* instead of said:

- **Short** → the badge in the corner of the thumbnail, where a search result
  already puts its duration.
- **Watched** → the dimmed thumbnail, which already existed.
- **Kept / Dismissed** → the marker badge, which already existed.
- **Watch Later / Search** → shown in the age's place, and only for the items
  that have no publish date, so the gap still reads as a fact rather than a bug.
- **View count** → dropped. It is not what you choose by.

Search results lose their view count on the phone for the same reason; the
duration badge stays, because that *is* what you choose by.

The desktop line is untouched — `deskSub` and `phoneSub` in `src/subscriptions.ts`,
both pure, both tested.

---

## Acceptance criteria

- [x] No reserved empty row anywhere above the video on a phone.
- [x] The video's top edge meets the bottom of the view header.
- [x] No dead space under the control row.
- [x] Every hover rule is behind a pointer media query.
- [x] The delete column runs the full height of its row and meets the
      separators above and below it.
- [x] The transport group is centred on the screen at 360, 375 and 390pt, and
      the row never wraps.
- [x] Pressing any control changes nothing but the symbol inside it — no fixed
      size in the row depends on state.
- [x] A phone row's second line is at most two segments.
- [x] `npm run check` clean: 179 tests, build clean.

## Manual test (for BarkernotBob)

Do this on the iPhone. Force-download the vault and fully relaunch Obsidian
first, or you will be testing yesterday's build.

**A — the video and the space around it**

1. Open any note in `Watch Later/`. The video should start immediately below
   the header bar at the top of the screen — no empty strip, no blank line.
2. Tap the poster. While it says "Resolving stream…", the message should appear
   **across the top of the picture**, not above it, and nothing on the screen
   should move when it appears or disappears.
3. Look at the gap between the bottom of the video and the row of buttons, and
   between the buttons and the first line of your note. Both should be small
   and even. Nothing should be flush against the left edge of the screen.

**B — the controls**

4. The row should be one line: `1×` and a PiP symbol on the left, then
   **⏪ ▶ ⏩** in the middle of the screen, then fullscreen and a chevron on the
   right. Play is the bigger round accent-coloured one.
5. Hold a ruler (or your thumb) to the screen: the ▶ should be at the centre of
   the screen, not off to one side.
6. Tap ▶. It becomes ⏸ and **nothing else moves** — no button shifts, the video
   does not jump, the note text below does not move.
7. Tap ⏪ and ⏩. Each should jump 10 seconds; each has a small "10" in its
   corner.
8. Change the speed to 1.75×. The pill must not get wider, and nothing beside
   it may move.
9. Tap the chevron on the right. The video folds away and the chevron flips.
   Tap it again to bring it back.

**C — the hub list**

10. Open the YT Free hub. Every row should have a thin line under it, running
    the full width of the screen.
11. The delete (×) column on the right: its dividing line should run the whole
    height of the row and **meet the lines above and below it** — no floating
    stub of a line.
12. Tap a row's × to remove it. Then look at the row that took its place, and
    at the row you tapped before that: **no grey box should be left behind
    anywhere**, on the row or on the button.
13. Tap a row to open it, then come back. Same check — nothing should still be
    grey.
14. Each row's second line should read as just `Channel · 3 days ago`. A Watch
    Later or search item with no date should read `Channel · Watch Later` or
    `Channel · Search`. A Short should say "Short" in the corner of its
    thumbnail rather than on the line.
15. A video you have already watched elsewhere should still be dimmed.

**D — search**

16. Tap the YouTube button, search for something. The result rows should read
    `Channel · 2 days ago` with the duration in the thumbnail corner — no view
    count.
17. Tap a result to add it. The + becomes a tick, and **the row must not
    move** while that happens.

**E — the desktop, which should be unchanged**

18. On the Mac, open a note with a video. The controls are still the row of
    words: Play, −10s, +10s, speed, PiP, Fullscreen, Timestamp, Collapse,
    Download — in that order.
19. The one thing that *should* look different: the pinned player's left and
    right edges now line up with the note text, and the strip of empty space
    that used to sit under its buttons is gone.
20. Hub rows on the Mac still show the full line — channel, age, views, and any
    flags — and still highlight on mouse-over.
