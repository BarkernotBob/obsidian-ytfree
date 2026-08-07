# 039 — The transcript stays reachable, instead of living under the description

Status: **Scoped 2026-08-06 — not built.** From BarkernotBob's manual test:

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

## Manual test (for BarkernotBob)

_Written when this is built._

## Depends on

Settle [037](037-popover-not-a-sheet.md) first or at the same time — both change
the Preview sheet's layout, and 037 decides whether a portalled popover has to
survive this region scrolling underneath it.
