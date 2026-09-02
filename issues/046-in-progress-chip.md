# 046 — An "In progress" list: what you started and did not finish

**Status:** **Built 2026-09-02.** Scoped 2026-09-01, decided by BarkernotBob on
2026-08-06 and left in HANDOFF prose until then.

**Created:** 2026-09-01

## Problem

There is no list of what you are part-way through. The hub's four chips answer
*undecided*, *opened*, *turned down* and *everything* — all of them questions
about a **decision**, none about **progress**. A 40-minute video you are 12
minutes into is Kept, sitting among a hundred other Kept videos with nothing to
distinguish it, and the way back to it is remembering its title.

This is the one list that would actually be used daily, and the data for it has
existed since 012 — `progress.json` has held resume positions all along.

## What it should do

**A fourth chip, In progress**, after Inbox / Kept / Hidden and before or beside
Everything — the order is a judgement to make on screen, not on paper.

**A video is in progress when it has a stored resume position past a floor.**
The floor is **10% of the video's duration, or 2 minutes, whichever is smaller**
— so a 40-minute lecture qualifies at 2 minutes in, and a 5-minute video at 30
seconds. Below that you did not start it, you glanced at it.

**It leaves the list when the video is finished**, and this is already free:
`recordPosition` clears the stored position outright when `isFinished(at,
duration)` ([progress.ts:133](../src/progress.ts)), so a finished video has no
position and cannot match. No new state, no second definition of "done".

**Backed by `progress.json`, explicitly not by a Dataview query over note
frontmatter.** This was decided and the reason holds: the position is written by
the player many times a session, frontmatter is not, and a list that disagrees
with the player about where you are is worse than no list.

**Rows sort by most recently watched**, which is the only order this list can
sensibly have.

## The seams that already exist

- `ProgressStore` gained two-way disk sync on 2026-08-17 (mtime watermark,
  refresh on focus, read-merge-write on save), so a position written on the
  phone is visible on the Mac. This list will be correct across devices on the
  day it is built, which was not true a month ago.
- `resumePoint` and `isFinished` are pure and tested
  ([progress.ts](../src/progress.ts)).
- The chips are a `FILTER_LABELS` table plus a `FILTER_RULES` sentence each
  ([hub.ts:976](../src/hub.ts)); a fifth entry is the shape the code expects.
- `HubFilter` is a union type, so the compiler will find every place that
  switches on it.

## The one thing to decide while building

`progress.json` prunes positions after `PROGRESS_TTL_DAYS`
([progress.ts:238](../src/progress.ts)). A video you started four months ago and
abandoned will silently leave the list when its position expires. That is
probably right — an abandoned video is not "in progress" forever — but it means
the list quietly forgets, and the TTL was chosen for a file's size, not for this
list's meaning. Check the number is still defensible once this list exists.

## Acceptance criteria

1. A fifth chip, In progress, lists every video with a stored position past the
   floor, most recently watched first.
2. The floor is `min(0.1 × duration, 120s)`, and a video below it does not
   appear.
3. Finishing a video removes it from the list without any additional bookkeeping.
4. A video started on the phone appears in the list on the Mac after the
   position syncs, and vice versa.
5. The chip's `FILTER_RULES` sentence says what the list contains, in the voice
   of the other four.
6. Selecting the chip does not reflow anything, and the list keeps its scroll
   depth across a merge-driven redraw (the 034 contract).
7. A video with no known duration does not appear rather than appearing with a
   guessed floor.
8. Nothing reads note frontmatter to build this list.

## Manual test (for BarkernotBob)

To be written when this is built, per the repo rule. It needs both devices for
criterion 4, and a video watched past two minutes and abandoned for the rest.

## Notes

- Duration is `undefined` on hub items until a poll backfills it
  ([subscriptions.ts:60](../src/subscriptions.ts)), which is what criterion 7 is
  about. `progress.json` records duration alongside the position, so prefer that
  source — it is the number the player actually saw.

## Built — 2026-09-02

All eight criteria. `progress.ts` grew the rules, `visibleItems` grew the list,
and the chip row grew a fifth chip.

- **`inProgressFloor(duration)`** is `min(0.1 × duration, 120s)` and **null when
  the length is not known** — criterion 7 falls out of the return type rather
  than out of a check somewhere.
- **`inProgressVideos(state, durationFor)`** returns id → when you last watched
  it. Finishing is not re-defined here: `recordPosition` deletes the entry at
  the credits and has since 012, so a finished video simply cannot be in the map
  (criterion 3).
- **`WatchPoint` gained an optional `duration`.** The issue's note said
  `progress.json` "records duration alongside the position, so prefer that
  source" — it did not, so now it does. It is what the player measured, and it
  is the right source precisely because a hub item's `durationSeconds` is
  `undefined` until a poll backfills it and a Watch Later item may never get one
  at all. The hub item stays as the fallback, for entries written before today.
  `recordPosition` writes a late-arriving duration even when the second has not
  moved, which turns an entry the list had to skip into one it can judge.
- **`visibleItems` takes `inProgress`** and sorts by it — most recently watched
  first, which is the only order this list can sensibly have. A **dismissed**
  video never appears even with a position: you watched five minutes and then
  turned it down, and that is a decision rather than a video you are in the
  middle of.
- **The chip sits second**, after Inbox. The issue left the position open; the
  reason for second is that this is the only one of the five with a daily use,
  and the four others are all questions about a decision. `FILTER_RULES` says
  *started and not finished — most recently watched first*.
- **Nothing reads frontmatter** (criterion 8), and the reason is written at
  `inProgressVideos` and again at `Plugin.inProgressVideos`: the player writes a
  position many times a session and frontmatter never, so a list built from
  notes would disagree with the player about where you are.
- **Two devices** (criterion 4) come free from `ProgressStore`'s two-way sync of
  2026-08-17. The map is rebuilt on every draw rather than cached, so a merged
  position is in the list the next time it is rendered.
- **No reflow** (criterion 6): the chip row now wraps, and each chip is
  `white-space: nowrap` so none can change height when the row gets tight. The
  active state is still a background change only. On the phone the chips are
  `flex: 1 1 30%` — three across, then two — because five 40pt targets do not
  fit across a phone and a 60pt target is worse than a second row in a sheet
  that is already a disclosure.

### The TTL, checked as the issue asked

`PROGRESS_TTL_DAYS` is **365**, and it stands. A video you started and have not
touched in a year is not "in progress", it is abandoned, and the list quietly
forgetting it is the behaviour you want rather than a wart. The number was
chosen for the file's size and happens to be defensible for this too; nothing
changed.

### Tests

573 unit tests, eleven new, `tsc` clean, build clean. One existing assertion
changed: `recordPosition` now writes a `duration` alongside the position.

## Manual test

**One device (five minutes).**

1. Open the hub. There are five chips: Inbox, **In progress**, Kept, Hidden,
   Everything. Click each in turn — nothing on the screen moves except the list.
2. Click In progress on a fresh install. Empty, and the status line reads
   *0 videos · started and not finished — most recently watched first*.
3. Open a video over 20 minutes long and watch past 2:00. Close it. Click In
   progress: it is there, first.
4. Open a video **under** 20 minutes and watch 30 seconds. It appears only if 30
   seconds is a tenth of it or more — so a 5-minute video qualifies, a 20-minute
   one does not. Check one of each.
5. Scrub the first video to its last minute and let it play out. Click In
   progress: it is gone, and you did nothing but finish it.
6. Hide a video you are part-way through. It leaves In progress and appears in
   Hidden.

**Two devices (criterion 4).**

7. On the iPhone, watch three minutes of a long video you have not started. Let
   the player close properly.
8. On the Mac, wait for the progress file to sync, then open the hub and click
   In progress. The video is there, at the top — it is the most recently
   watched. Reverse the devices and repeat.
