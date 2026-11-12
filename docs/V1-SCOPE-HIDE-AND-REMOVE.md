# V1 scope: Remove vs Hide (hub and search)

**Written:** 2026-11-12, from Isaiah's four MVP asks in the thread "Fix hidden and removed videos in hub":

1. On mobile you can't restore removed videos: the rows render over one another.
2. A hidden video that would show in a search still lists, without the picture, with the title
   and all the normal watch options.
3. Removing a video from the hub only removes it from the hub. It is not hidden from search.
4. On search cards the Remove button says **Hide**. That is what hides the picture and puts the
   video in the Hidden list.

**Status:** draft, decisions D1–D3 below awaiting Isaiah. Built on the recommended answers.

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

1. **Phone rows fixed.** The row stays a flex line on the phone (title and channel left, restore
   button right, 44px target), with no fixed height. A harness check measures that no row
   overlaps the next and every restore button is fully inside its row.
2. **Two lists in the hub (D1):**
   - **Removed** (was "Hidden"): videos you removed from the hub. ↺ puts one back in the Inbox,
     as today. Status line: "you removed these from the hub".
   - **Hidden** (new chip): videos you hid from search. Each row has **Unhide**. This replaces
     Settings → "Removed from search" (that button goes; "Hidden from search" for channels stays).
3. **Removing from the hub no longer touches search.** A removed video comes back in search as a
   normal card with its picture. Its Save button reads as not saved. Save or Watch first puts it
   back in the hub properly (picture and description fetched again), then works as on any search
   card: Save makes the note (Saved), Watch makes it and opens it.
4. **Search Remove becomes Hide.** Same in-place strip ("Hidden · Undo"), stored in the same
   synced list as today (`searchRemovedVideos`, so no file migration).
5. **A hidden video in a later search (D2)** is a text card: no picture, title, channel, age and
   duration, and the four buttons Preview / Watch / Save / **Unhide**. Unhide redraws it with its
   picture where it is. Save and Watch work as on any card and leave it hidden from search.
6. **Channel screen:** same as search (hidden videos are text cards, the button says Hide).
7. **Inbox and Saved videos stay skipped in search (D3)**, as today and as PR #104 keeps it.

## Data

No new fields. `searchRemovedVideos` keeps its name and sync rules; it now means "hidden from
search". The hub's dismissed tombstones keep theirs; they now only mean "removed from the hub".
Effect on existing data: everything already on the old Hidden chip moves to Removed and starts
showing in searches again; everything in Settings → "Removed from search" moves to the Hidden chip
and shows in searches as a text card.

## Decisions (Isaiah)

- **D1. Two lists, "Removed" and "Hidden"?** Recommended: yes, as above. Alternative: one Hidden
  chip with two sections.
- **D2. Hidden card's fourth button = Unhide?** Recommended: yes. Alternative: keep it Hide, greyed.
- **D3. Inbox and Saved videos still skipped in search?** Recommended: yes (unchanged). Alternative:
  show them with a "Saved"/"In inbox" tick.

## Not in v1

- Hiding a video from the hub's own lists by any other route, bulk unhide, hide reasons.

## Manual test (after the build)

See the thread reply; steps are kept there and in the PR.
