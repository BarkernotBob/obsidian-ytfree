# 047 — A search Remove that lasts, and a way to mute a channel in search

**Status:** Scoped 2026-09-01. **Not built.** This is **stage two of
[docs/V1-SCOPE-CARD-CONTROLS.md](../docs/V1-SCOPE-CARD-CONTROLS.md)**, written
2026-07-30, listed as "next" in the write-ups for both
[023](023-card-controls-layout.md) and [024](024-preview-plays.md), and never
filed. Stages one and three shipped; stage two did not.

**Created:** 2026-09-01

## Problem

Remove on a search result forgets. `removedResults` is a `Set<string>` that is
cleared on every new search ([hub.ts:1732](../src/hub.ts),
[hub.ts:1756](../src/hub.ts)), and the code says so in two places —
*"Session-only on purpose at this stage"* ([hub.ts:1063](../src/hub.ts)) and
*"It survives until the next search and no further"*
([hub.ts:2015](../src/hub.ts)). Both comments point at this issue's contents as
the thing that was going to finish it.

So the button is honest about a single search and dishonest about the feature:
you turn a video down, search again, and it is back. The same is true of every
video from a channel you never want to see — there is no way to say so at all,
because **Hide channel was scoped for v1 and never built**. The `⋯` chip does
not exist.

## What it should do

The scope doc already decided all of this; it needs building, not re-deciding.
Restated so this file stands alone:

**A persistent search blocklist**

- Removing a search result records it durably, and it stays removed across
  searches, restarts and devices.
- **Deliberately not the Hidden filter.** Hidden is the drawer you visit to undo
  hub mistakes; things you never collected must not fill it. Separate list,
  separate meaning.
- Two ways back, both already specified: the same-height **"Removed — Undo"
  strip** at the moment of the action (already built, keep it), and a **list in
  Settings** for later.

**Hide channel**

- A `⋯` chip in the top corner of a **search card's** thumbnail, scrimmed so it
  survives a light thumbnail.
- One menu item today, "Hide this channel" — a menu rather than a fifth button
  precisely so later secondary actions have somewhere to go without competing
  with the four.
- Hidden channels **filter search results only**. They are a list separate from
  subscriptions.
- **Subscribing to a hidden channel wins**: the hide is dropped, with a notice.
  This gets sharper once [045](045-channel-screen-and-subscribe.md) exists,
  because subscribing becomes something you can do from inside the plugin.
- A Settings list to undo channel hides, beside the video one.

## Where the state goes, and the question to answer first

Both lists have to cross devices, which means `subscriptions.json` and
`mergeStates`. That file already carries four tombstone-ish lists —
`removedChannels`, `deletedVideos`, `notifiedVideos`, and hidden items inside
`items` — each unioned with slightly different rules about when a tombstone
loses its argument.

**Do not add a fifth and a sixth without reading how the other four merge.**
The rules genuinely differ: `deletedVideos` is pruned once its video is back,
`notifiedVideos` is never pruned, `removedChannels` loses to a later `addedAt`.
Pick deliberately and write the reason in the code, as those three did.

Note also that `pruneWordLists` exists because this file syncs through iCloud on
every write — an unbounded blocklist of every video you ever declined is a cost,
and a growth bound is part of building this, not a later tidy.

## Acceptance criteria

1. A removed search result stays removed across a new search, a restart, and on
   the other device.
2. Removed search results never appear under the Hidden filter.
3. The "Removed — Undo" strip behaves exactly as it does today, at the same
   height, with no reflow.
4. Settings has a list of removed search videos, and undoing one there makes it
   searchable again.
5. A `⋯` chip on a search card's thumbnail opens a menu with "Hide this
   channel", and is legible on a white thumbnail.
6. Hiding a channel removes its results from the current search and from later
   searches, on both devices.
7. Hidden channels do not affect the hub, the feed poll, or anything a
   subscription drives.
8. Subscribing to a hidden channel drops the hide and says so.
9. Settings has a list of hidden channels, and undoing one there restores its
   results.
10. Both lists have a documented growth bound.
11. Nothing about the four card buttons' size, position or no-reflow behaviour
    changes.

## Manual test (for BarkernotBob)

To be written when this is built, per the repo rule. Criteria 1 and 6 need both
devices.

## Notes

- The `⋯` chip is the one piece of new UI. Everything else is persistence behind
  behaviour that already exists on screen.
- Stage three (the standalone player) shipped as [024](024-preview-plays.md), so
  after this the card-controls scope is closed and the doc can say so.
