# 042 — A tidied note takes its hub item with it

Status: **Scoped 2026-08-06 — not built.** Asked for by BarkernotBob:

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

## Manual test (for BarkernotBob)

_Written when this is built._
