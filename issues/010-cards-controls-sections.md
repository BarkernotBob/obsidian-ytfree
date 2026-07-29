# 010 — Hub cards, a designed control bar, and note sections

Status: **Built 2026-07-29 — awaiting manual test.**

Seven asks from BarkernotBob. Items 4–7 are the note's structure and are one change;
items 2 and 3 are the control bar and are another.

---

## 1. Four cards a screen, not seven

At 76px a phone row was a thumbnail, a title and eight grey words — enough to
recognise a video you already knew about and nothing at all for one you didn't,
which is the entire job of a subscriptions list.

The card is 148px now, laid out as a grid so the delete column can span both
rows of content:

```
┌──────────────────────────────┬────┐
│ [thumb 128×72]  title (2 ln) │    │
│      1:02:03    channel · age│  ×  │
├──────────────────────────────┤    │
│ description, 3 lines, clamped│    │
└──────────────────────────────┴────┘
```

Measured with `tools/phone-hub-harness.mjs` at 390×844: **4 cards fully
visible, a fifth partly**, every card exactly 148px.

The three facts asked for:

- **Channel and publish time** — the second line, unchanged (`phoneSub`).
- **Video length** — the badge in the corner of the thumbnail, and this is the
  part that needed new data. A channel RSS feed carries no duration and never
  has; only a search result does. `HubItem` gained `durationSeconds`, and
  `backfillDurations()` fills it from the InnerTube player endpoint at poll
  time — newest first, 40 per poll, four at a time, skipping tombstones. So an
  existing 264-item hub fills in over a few polls rather than in one thirty-
  second stall. `undefined` means never asked, `null` means asked and refused;
  a video that will not say its length shows "Short" if it is one and nothing
  if it is not.
- **Description** — `cardBlurb()`, which is not the raw description. It drops
  bare-URL lines, chapter-stamp lines and hashtag-only lines, collapses the
  whitespace and cuts on a word boundary at 220 characters. What is left is
  prose, and three lines of prose is a summary.

## 2. A control bar, not a utility terminal

It was two designs: a left-packed row of seven text buttons of seven different
widths on the desktop, and a symbol grid on the phone. The grid was the one
that was right, so both get it — one `1fr auto 1fr` surface, transport in the
middle cell, one 40px square per control at one spacing, and Play round, larger
and in the accent colour because it is the one you reach for.

Two defects the phone harness caught that no amount of reading would have:

- **Obsidian's `button:not(.clickable-icon)` is (0,1,1) and beat every
  single-class rule in this stylesheet.** Every control was rendering as a grey
  slab with an inset highlight and a drop shadow — the accent Play included,
  which was coming out as a dark circle. That is most of what "utility
  terminal" was. All the button rules are scoped now (`.ytfree-controls
  .ytfree-btn`, `.ytfree-sections .ytfree-section-link`), which also fixes the
  hub's icon buttons, where the same rule had been winning silently.
- **The bar overflowed a 390pt screen.** The compact step was gated at
  `max-width: 380px`, so every current iPhone (390, 393, 402, 430) got the full
  40px sizes and ran off the edge. The breakpoint is 460px now. Measured: no
  overflow at 375, 390, 430 or 900, and Play within 1px of centre except on the
  375pt SE, where it is 8px left of it.

## 3. Notes · Description · Transcript

A second row under the bar: three equal buttons that jump to the note's own
headings. Text, not symbols — there is no icon for "the transcript", and a
control that navigates somewhere should say where.

Jumping unfolds the target section first (a jump that lands on a collapsed
heading reads as a broken link) and only that one; the rest stay as you left
them. Tapping **Notes** also puts the cursor under the heading, because that is
what you tapped it for. The other two do not: a cursor parked in the transcript
would send the next thing you type into someone else's words.

## 4–7. The note's structure

- **Two blank lines under Notes**, so there is somewhere to write before the
  description starts.
- **Opens with Notes expanded, everything else folded.** `applyDefaultFolds`,
  once per file per view, exactly like `collapseProperties` — unfold a section
  and it stays unfolded until you open another note. Off with **Collapse
  description and transcript** in settings.
- **"Video Description" and "Video Transcript"**, and **all headings level 1**.

All four sections now live in one file, `src/sections.ts`: the note builder,
the transcript fetch, the section buttons and the fold defaults each used to
spell their own headings, which is how the transcript heading and the template
drifted apart in the first place.

**Nothing rewrites an existing note.** ~50 notes carry `## Notes`,
`## Description` and `## Transcript`, and every lookup accepts those spellings —
the buttons work, the folds apply, and a transcript re-fetch replaces the old
section rather than appending a second one beside it. The opt-in half is the
command **"Rename this note's sections to Video Description / Video
Transcript"**, one note at a time.

Templates updated in both places: `templates/` in the repo, and the live
`Templates/8.Watch_Later_Template.md` and `System Templates/Obsidian Clipper -
Watch Later (YT Free).json` in the vault.

---

## Acceptance criteria

- [x] Exactly 4 phone hub cards fully visible on a 390×844 screen, measured.
- [x] Every card is the same height whatever its title, blurb or badges.
- [x] Channel, publish age, length and a truncated description are all on the
      card.
- [x] Duration backfills for existing items without a blocking stall.
- [x] One control-bar design on both platforms; no control renders with
      Obsidian's default button chrome.
- [x] The bar does not overflow at 375, 390, 430 or 900pt.
- [x] Notes / Description / Transcript buttons jump to their headings and
      unfold them.
- [x] A new note has two blank lines in its Notes section.
- [x] A video note opens with Notes expanded and the rest folded.
- [x] Headings are `# Notes`, `# Video Description`, `# Video Transcript`,
      `# Most replayed`.
- [x] Old notes still work everywhere, unrewritten.
- [x] `npm run check` clean: 194 tests, build clean.

## Manual test (for BarkernotBob)

Do the phone half on the iPhone. Force-download the vault and fully relaunch
Obsidian first, or you will be testing yesterday's build.

**A — the hub list (phone)**

1. Open the YT Free hub. Count the videos you can see without scrolling:
   **four**, with the top of a fifth showing.
2. Each card should show, in this order: a thumbnail with a length in its
   corner (`12:34`), the title on up to two lines, `Channel · 3 days ago`, and
   two or three lines of description underneath.
3. Some cards will have no length in the corner at first. Tap the refresh
   button in the header, wait for it to finish, and check again — more of them
   should have one each time, until they all do. (Videos that are private or
   age-gated never will.)
4. Find a video whose description starts with a sponsor link or a chapter list.
   The description on the card should skip those and show actual sentences.
5. Scroll the list. Every card should be exactly the same height — no card
   taller because its title is longer.
6. Tap a card's ×. Nothing else on the screen should move except that row
   going.

**B — the buttons under the video (phone and Mac)**

7. Open any note in `Watch Later/`. Under the video there should be **two
   rows**: the control bar, then `Notes | Description | Transcript`.
8. Nothing in either row should look like a raised grey button with a shadow.
   They should be flat symbols on one dark strip — except **▶**, which is a
   round accent-coloured circle.
9. Check the right-hand end of the bar is not cut off by the edge of the
   screen. Rotate to landscape and check again.
10. Tap ▶, change the speed, tap the collapse chevron. Each time, **nothing
    else may move** — no button shifts, no text below jumps.
11. On the Mac, the same two rows should appear, same shapes, wider apart.

**C — the section buttons**

12. Tap **Transcript**. The note should scroll to `# Video Transcript` and the
    transcript should be *open* (it starts folded — see D).
13. Tap **Description**. Same, for `# Video Description`.
14. Tap **Notes**. It should scroll to `# Notes` **and put the cursor there**,
    ready to type.
15. Open an *old* note — one from before today, with `## Notes` and
    `## Description`. All three buttons should still work on it.

**D — how a note opens**

16. Close and reopen a Watch Later note. `# Notes` should be open, and
    `# Video Description`, `# Video Transcript` and `# Most replayed` should be
    folded shut.
17. Unfold the description, then scroll around and come back. It should stay
    unfolded.
18. Open a *different* note, then come back to this one. It should be folded
    again — that is the default reasserting itself, not a bug.
19. If you would rather it did not: Settings → YT Free → **Collapse description
    and transcript**, off.

**E — the new note shape**

20. Clip a new video with the Web Clipper, or run the Watch Later template.
    Under `# Notes` there should be two blank lines, then `# Video
    Description`. Every heading should be level 1 (one `#`).
21. Run **YT Free: Fetch transcript and most-replayed moments** on it. The new
    sections should be `# Video Transcript` and `# Most replayed`.
22. Now do the same fetch on an **old** note that already has `## Transcript`.
    Afterwards it should have **one** transcript section, named
    `# Video Transcript` — not two.
23. On an old note, run **YT Free: Rename this note's sections to Video
    Description / Video Transcript**. The four headings should become level 1
    with the new names, and nothing else in the note should change. Run it
    again: it should say "headings already current".
