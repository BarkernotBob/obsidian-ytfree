# 042 — A tidied note takes its hub item with it

Status: **Built 2026-08-06 — not yet tested on the phone.** Asked for by
BarkernotBob:

> "another issue that removes videos from kept at the same time they get added
> to tidy empty notes"

## What is wrong

Two features that were built to mean the same thing currently disagree.

The tidy sweep ([017](017-skip-fold-tidy.md), `tidyEmptyNoteDays`, default 30)
trashes a video note you played, wrote nothing in, and left closed for a month.
The judgement it encodes is *you watched this and it was not worth keeping*.

The hub does not hear about it. The item stays `kept` with a `notePath`
pointing at a file that no longer exists — and `openItem` treats a dead path as
something to repair, so clicking it builds the note again. The video you decided
against a month ago is back, in the same list, indistinguishable from the ones
you meant to keep.

Compounding it: `expireItems` exempts kept items from age expiry
unconditionally, and BarkernotBob's `subscriptionsExpiryDays` is `0` so nothing ages
out anyway. Kept is therefore permanent for everything that has ever been
opened. It is the list of "videos I clicked once", growing without limit, and
the tidy sweep is the only signal in the whole plugin that any of them turned
out not to matter.

## What it should do

**When the sweep trashes a note, the hub item leaves Kept in the same
transaction.**

It should become **dismissed**, not deleted. A dismissed item is a tombstone,
which is what stops the next poll re-adding the video to the Inbox — deleting
the row outright would resurrect it within twelve hours. It also means the video
shows up in the Hidden list, so a sweep that took something you wanted has a way
back, which a deletion would not.

Points that need to hold:

- **One decision, both stores.** The note going to the trash and the item
  leaving Kept must not be able to happen separately — a sweep that trashes the
  file and fails to write `subscriptions.json` leaves exactly the dead-path
  state this issue exists to remove. If the write is refused (034's rule: never
  overwrite a file we could not read), the trash does not happen either.
- **`dismissedAt` is the sweep's timestamp**, so the tombstone ages the same way
  a manual removal does.
- **The tombstone cap still applies.** `HIDDEN_LIMIT` is 500, oldest-hidden
  first off the end. Swept items now compete for that budget with videos hidden
  by hand. Worth a look at whether the cap needs raising once the sweep is
  feeding it — the same concern [018](018-watch-later.md) raises from the other
  direction.
- **Only the sweep.** Deleting a note by hand already has its own answer in
  [026](026-delete-removes-from-hub.md); this must not change that path or
  double up with it.
- **Nothing that had writing in it is touched**, which `hasWriting()` already
  guarantees — this issue adds no new judgement about which notes go, only about
  what happens to the hub item when one does.

## Acceptance criteria

- [ ] A note trashed by the tidy sweep leaves its hub item in the Hidden list,
      not in Kept.
- [ ] The next poll does not bring the video back into the Inbox.
- [ ] The item is recoverable from Hidden, and recovering it restores a working
      note.
- [ ] A note with writing in it is neither trashed nor un-Kept.
- [ ] If the subscriptions write is refused, the note is not trashed either —
      the two never diverge.
- [ ] Manual note deletion still behaves as [026](026-delete-removes-from-hub.md)
      specifies.
- [ ] Unit tests cover: swept-and-tombstoned, swept-then-repolled, refused
      write, and a note with writing.
- [ ] `tsc` clean, build clean, unit tests pass.

## How it was built

The sweep does the two writes in a fixed order, and the order is the whole
design: the hub goes first, because the hub is the only one of the two that can
*refuse*. `SubscriptionsStore.sweepAway` marks the item dismissed and reports
whether the write actually landed — which needed `save()` to grow a variant that
says so, since the old return value conflated "no state file yet" with "the
state file could not be read, so nothing was written" (034).

- Hub refused → the note is left alone, and the sweep logs why. Nothing
  diverges, because nothing changed.
- Hub written, trash failed → the tombstone is rolled back and the item returns
  to Kept exactly as it was.

That rollback puts back a verbatim snapshot rather than calling `restoreItem`,
which would stamp a fresh `decidedAt` — a new decision would beat the Kept row
still sitting on another device's copy and demote it at the next merge, and
would set off a description re-fetch for a video nobody touched.

The decision itself is `sweepNote` in `src/tidy.ts`, which takes the hub and the
trash as arguments so both orderings and both failures are tested without a
vault (`tests/tidy.test.ts`). The item becomes a tombstone, not a deletion:
`tests/subscriptions.test.ts` pins that the next poll does not resurrect it,
that it is out of Kept and in the hidden list, that Restore brings it back with
its note path intact, and that it ages out under the same limit as everything
else.

## Manual test (for BarkernotBob)

1. In the hub, Keep a video you do not care about. A note is written for it.
2. Open the note and delete everything you wrote under **Notes**, leaving the
   section empty. (A note that was never written in is fine too.)
3. Wait for the tidy sweep — or restart Obsidian, which runs it on load. The
   note should be in the trash.
4. Go back to the hub and look at **Kept**. The video should be **gone** from
   it, in the same pass — not still sitting there with a note that no longer
   exists.
5. Check **Hidden/Dismissed**. It should be there, and **Restore** should bring
   it back to Kept.
6. Let the channel poll run again (or press Refresh). The video must *not*
   reappear in the list on its own.
7. Only if you want to see the refusal path: on a second device with the vault
   mid-sync, an unreadable state file means the note is left alone and the
   console says so — nothing is half-done.
