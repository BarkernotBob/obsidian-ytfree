# V1 scope: Remove vs Hide (hub and search)

**Written:** 2026-11-12, from Isaiah's four MVP asks in the thread "Fix hidden and removed videos in hub":

1. On mobile you can't restore removed videos: the rows render over one another.
2. A hidden video that would show in a search still lists, without the picture, with the title
   and all the normal watch options.
3. Removing a video from the hub only removes it from the hub. It is not hidden from search.
4. On search cards the Remove button says **Hide**. That is what hides the picture and puts the
   video in the Hidden list.

**Status:** D1–D3 answered by Isaiah 2026-11-13 00:51Z (see Decisions). Built on PR #110.

## What the code does today (main bd069ef)

- Hub **Remove** = `hide()` → item `state: "dismissed"` (a tombstone). It shows on the **Hidden**
  chip with a restore arrow. Search drops it, because `acceptable` drops every result the hub
  has (`hasItem`, which counts tombstones).
- Search **Remove** = `setSearchRemoved` → `searchRemovedVideos` blocklist. The video never shows
  in search or on a channel screen again. Undo is in Settings → Subscriptions hub → "Removed from
  search".
- **Phone bug (item 1), measured in Chromium with the plugin's CSS at 390px:** the phone card rule
  `.ytfree-phone .ytfree-hub-card { display: block; overflow: hidden }` also hits the hidden rows,
  so the row stops being a flex line. The text stacks (~60px) inside a fixed 64px row and the
  44px restore button lands below it, mostly clipped and sitting on the next row.

## v1

1. **No list for removed videos (D1).** Hub Remove takes a video out of the hub (a tombstone, so
   the next poll does not bring it back) and that is all. The old Hidden chip, which held them, is
   gone: you find a removed video again by searching for it. Item 1's restore problem goes with it.
   The phone row fix (rows stay a flex line, restore/unhide button inside its row) is kept, since
   the new Hidden list uses the same rows.
2. **Hidden** (new chip): videos you hid from search, newest first, each with **Unhide**. This
   replaces Settings → "Removed from search" (that button goes; "Hidden from search" for channels
   stays).
3. **Search shows everything except repeats (D3).** Inbox, Saved and removed videos all list as
   normal cards; Save and Watch read done where that is true. Save or Watch on a removed video first
   puts it back in the hub properly (picture and description fetched again), then works as on any
   search card.
4. **Search Remove becomes Hide.** Same in-place strip ("Hidden · Undo"), stored in the same
   synced list as today (`searchRemovedVideos`, so no file migration).
5. **A hidden video in a later search (D2)** is a text card: an empty "Hidden" box the size of the
   picture (no image requested), title, channel, age and duration, and Preview / Watch / Save /
   **Unhide**. Unhide redraws it with its picture where it is. Save and Watch work as on any card
   and leave it hidden from search.
6. **Channel screen:** same as search (hidden videos are text cards, the button says Hide).

## Data

No new fields. `searchRemovedVideos` keeps its name and sync rules; it now means "hidden from
search". The hub's dismissed tombstones keep theirs; they now only mean "removed from the hub".
Effect on existing data: everything already on the old Hidden chip starts showing in searches
again and has no list of its own; everything in Settings → "Removed from search" moves to the Hidden
chip and shows in searches as a text card.

## Decisions (Isaiah, 2026-11-13)

- **D1. A list for removed videos?** **No:** "You could just search for a video if you removed it."
  Only the Hidden list exists. (Claude had recommended a Removed chip beside Hidden.)
- **D2. Hidden card's fourth button = Unhide?** **Yes.**
- **D3. Inbox and Saved videos in search?** **Show them too.** (Claude had recommended keeping them
  skipped.) Search now only drops repeats.

## Not in v1

- Hiding a video from the hub's own lists by any other route, bulk unhide, hide reasons.

## Manual test (after the build)

See the thread reply; steps are kept there and in the PR.
