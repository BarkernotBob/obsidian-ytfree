# 039 — The transcript stays reachable, instead of living under the description

Status: **Built 2026-08-06 — not yet tested on the phone.** From BarkernotBob's
manual test:

> "scroll working but transcript needs to be pinned to viewable at the bottom
> always, not buried below description."

## What is wrong

032 gave the Preview sheet a single scroller, which was right — two scrollers
fighting was the bug. But it left the running order it inherited: player,
then description, then transcript. The description is arbitrarily long. On a
phone a YouTube description with links, chapters and a sponsor block is several
screens on its own, so the transcript — the thing you are actually reading along
with while the video plays — begins somewhere below the fold and gets further
away the more the creator wrote.

Compounding it: with [035](035-follow-unfold-cursor-progress.md) the transcript
now *follows* playback. A pane that scrolls itself to stay current is worthless
if you have to scroll a screen and a half to see it, and worse than worthless if
it is quietly auto-scrolling out of sight while you read the description.

## What it should do

**The transcript occupies the bottom of the sheet and stays there.** Not "after
the description in document order" — a region of the sheet that is always on
screen while the video is:

- player at the top, transcript filling the space below it, both always visible;
- the description reachable but not in the way — collapsed by default, or
  behind the same section switch the control bar already offers;
- the transcript scrolls *within its region*, which is what makes follow-mode
  meaningful: it can autoscroll without moving anything else on the sheet;
- and the region has a floor, so a video with no transcript does not collapse
  the layout and a video with a long one does not push the player off screen.

This interacts with the single-scroller rule from 032 rather than reversing it.
One scroller for the sheet's own content stays correct; the transcript's region
is a distinct scrolling area with a distinct job, not a second scroller for the
same content. Whichever way it is built, dragging inside the transcript must not
scroll the sheet behind it.

Applies to the Preview window first. If the same ordering problem exists in a
note, fix it there too — but a note is a document and its running order is
Obsidian's, so the answer there may be the jump controls that already exist
rather than a pinned region.

## Acceptance criteria

- [ ] In Preview on the iPhone, the transcript is visible without scrolling, on
      a video whose description is long.
- [ ] The player stays visible at the same time.
- [ ] Playing the video autoscrolls the transcript inside its own region and
      moves nothing else on the sheet.
- [ ] Scrolling inside the transcript does not scroll the sheet behind it.
- [ ] A video with no transcript, and a video with a very long one, both leave
      the sheet usable.
- [ ] The description is still reachable in one obvious action.
- [ ] Landscape as well as portrait.
- [ ] `tsc` clean, build clean, unit tests pass.

## How it was built

The phone sheet stopped being a document and became three fixed things and one
elastic one: the picture at the top, the four buttons at the foot, the
description as a shut disclosure, and the transcript taking everything left
over. It is written as a flex column *on the element that scrolls*, which is not
a contradiction — a flex column only distributes free space, so with the
description shut the transcript fills the sheet, and with it open there is no
free space, the sheet scrolls exactly as 032 left it, and the transcript falls
back to a floor.

Three things that had to be true for that to work, each found by measuring:

- **A height, not a cap.** `.modal-content` had `max-height`, and a percentage
  of an auto-height parent is auto — there was no free space to give anyone.
- **The picture takes a share of the height, not of the width.** 16:9 of a
  phone held sideways is taller than the screen.
- **Landscape is a different layout.** Stacked, it does not fit at any picture
  size worth watching, so below 520pt of height the sheet is two columns:
  picture and facts on the left, transcript full-height on the right, buttons
  across the foot.

The transcript is open from the start on a phone, `overscroll-behavior: contain`
keeps a drag inside it from moving the sheet behind, and a video with no
transcript (or one that could not be fetched) drops `is-open` so the region
claims nothing at all.

Landscape has one honest shortage, written into the stylesheet where it happens:
picture, title, facts, a *readable* description and a full-height transcript do
not all fit in 390 points. At rest the transcript wins; opening the description
buys 30vh of text at the price of the sheet scrolling while it is open.

Measured rather than reasoned about — `node tools/preview-sheet-harness.mjs`
renders the real DOM against Obsidian's own `app.css` at 390×844 and 844×390 and
reports every number above.

## Manual test (for BarkernotBob)

On the iPhone, on a video with a long description — a Veritasium or an MKBHD,
anything with chapters and a sponsor block:

1. Open its Preview. **Without scrolling anything**, you should see: the
   picture at the top, a "Description" row, and the transcript filling the rest
   of the screen down to the four buttons.
2. Play it. The transcript should light the current paragraph and scroll itself
   to keep it near the top — and the picture should not move while it does.
3. Drag the transcript up and down with a finger. The picture stays put; the
   sheet behind it does not move.
4. Tap "Description". The description opens; the picture stays where it is.
   Tap it again to shut it.
5. Turn the phone sideways. The picture and the facts should be on the left,
   the transcript down the whole right-hand side, the buttons across the
   bottom. Tapping "Description" there opens a scrollable block of text and the
   sheet becomes scrollable while it is open — shut it and everything is back.
6. Open a Preview for a video with **no** transcript (an old upload, or one
   with captions off). The row should say "Transcript — none for this video"
   and the description should get the sheet — no empty grey area.
7. On the Mac, open any Preview. It should be what it always was: description
   in full, transcript shut behind its header.

## Depends on

Settle [037](037-popover-not-a-sheet.md) first or at the same time — both change
the Preview sheet's layout, and 037 decides whether a portalled popover has to
survive this region scrolling underneath it.
