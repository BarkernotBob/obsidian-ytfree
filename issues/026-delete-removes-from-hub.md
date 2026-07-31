# 026 — Deleting a note removes the video from the hub

Status: **Built 2026-07-31 — awaiting manual test.**

## The problem

Deleting a video note was invisible to the hub. The item stayed Kept, pointing
at a file that no longer existed, so the card kept offering **Open** on a note
that could not be opened — and the video kept its place in Kept forever.

Hiding it instead is the wrong instrument. Hidden is a judgement on the video:
it is a tombstone that follows the video into search and stops it ever being
offered again. Deleting a note is not that. It is "I am done with this one",
and the video should still be findable later.

## What was built

**A `deleted` event on the metadata cache**, not `vault.on("delete")`. By the
time the vault fires, the file is gone and there is no frontmatter left to read;
`metadataCache.on("deleted", file, prevCache)` hands over the last cache the
note had. The hub item's own `notePath` is the fallback for the case where
Obsidian has no previous cache to give.

**`forgetVideo` — out of every list at once.** The item is removed outright
rather than moved to Dismissed, so it is gone from Inbox, Kept and Hidden alike.
A note the hub never made an item for costs nothing: `forget` returns early.

**A `deletedVideos` tombstone, and why it is not the Hidden list.** A channel
feed is a rolling 15-entry window, so a video deleted today is still in it
tomorrow and `mergeItems` would read it as new. The tombstone stops that, and
it does only that:

| | Blocks the next feed poll | Blocks a search result | Shows in a list |
|---|---|---|---|
| Hidden (`dismissed`) | yes | yes | Hidden |
| Deleted (`deletedVideos`) | yes | no | nowhere |

**It merges like `removedChannels` does, because it has the same failure.** The
other device still holds the item — Kept, which outranks every other state in
`mergeItem` — so a union of the two item lists hands the video straight back.
`mergeStates` unions the deletions by latest stamp and applies them to the
merged list, and a deletion loses only to a decision made after it.

**Adding the video back clears the tombstone**, in `addSearchResult` and in
`live()`. A search item is now stamped with `decidedAt` for the same reason a
hidden one is: it has to outlive both a stale copy on the other device and its
own tombstone, and until now it carried no stamp at all to do it with.

Capped at `DELETED_LIMIT` (500), oldest first off the end, exactly like
`HIDDEN_LIMIT`. A tombstone that falls off means the video may reappear if its
channel feed still carries it, which after 500 deletions it will not.

## Acceptance criteria

- Deleting a video note removes that video from Inbox, Kept and Hidden.
- The next poll of that channel does not put it back.
- The video still appears in search results, and adding it from there works.
- A note with no video in its frontmatter, deleted, changes nothing.
- Deleting on the Mac does not come back from the phone's copy, or vice versa.
- Hiding a video is unchanged: it still lands in Hidden and still blocks search.

## Manual test (for BarkernotBob)

1. Open the hub and press **Save** on a video in the Inbox — it moves to Kept
   and a note appears in the Watch Later folder.
2. Delete that note (right-click the file in the sidebar → Delete).
3. Look at the hub: the video is gone from **Kept**. Check **Inbox** and
   **Hidden** too — it should not be in either.
4. Press **Check subscriptions for new videos** from the command palette. The
   video should stay gone.
5. Search for that video by title in the Browse box. It should still come up.
   Press **Add** on it — it lands in the Inbox as normal.
6. Now press **Remove** on a *different* video in the Inbox. It should go to
   **Hidden**, as before — deleting and hiding are still two different things.
7. If you have the phone open: delete a note on the Mac, then open the hub on
   the phone. The video should be gone there too, not back in Kept.
