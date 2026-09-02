# 046 — An "In progress" list: what you started and did not finish

**Status:** Scoped 2026-09-01. **Not built.** Decided by BarkernotBob on 2026-08-06
and left in HANDOFF prose until now.

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
