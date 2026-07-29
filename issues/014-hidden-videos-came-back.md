# 014 — Hidden videos came back

Status: **Built 2026-07-29 — awaiting manual test.**

BarkernotBob hid a batch of videos on the phone and they reappeared. He asked three
things: why, was it the recent work, and can it be prevented in future.

**Short answers:** two devices sharing one JSON file, last writer wins. No — no
code in 012 or 013 touches hide state. Yes, and the mechanism is below.

---

## What actually happened

`subscriptions.json` is a single blob in `.obsidian/plugins/ytfree/`, synced by
iCloud. `SubscriptionsStore` read it once at plugin load, held the whole thing
in memory for the life of the session, and every `save()` wrote that memory over
the entire file.

So: the phone hides six videos and writes the file. iCloud carries it to the
Mac. The Mac's Obsidian has been open since morning and holds a copy from
*before* those hides — and it polls every few minutes, each poll ending in a
save. That save rewrites the whole file from the stale snapshot. The hides are
gone, and iCloud carries the erasure back to the phone.

Nothing about it is new. It has been true since the hub shipped; it needed two
devices used within one session of each other to show up, which is exactly what
this week's phone testing was.

Evidence in the file as found: **7 dismissed items, every one of them with no
`dismissedAt`** — i.e. every surviving tombstone predates the field, and every
removal made since is absent. The vault's git backup excludes
`.obsidian/plugins/*/*`, and there are no local Time Machine snapshots, so
**the lost hides are not recoverable**. They have to be re-hidden once.

## The fix: a save is a merge

Three parts.

**1. Decisions are stamped.** New `HubItem.decidedAt` — set by `hideItem`,
`keepItem` and `restoreItem`. A decision can now be compared against the same
video's decision on another device, which is what makes anything else possible.

**2. `save()` re-reads and merges.** `mergeStates(mine, theirs)` is pure and
lives in `subscriptions.ts`. Per video: the newer decision wins. Facts — the
description, duration, Shorts flag, the earlier `seenAt` — are pooled from both
sides, because those are things *about* the video rather than choices about it.
A tombstone never gets its description handed back, since `hideItem` drops it on
purpose. Where the clocks tie (two legacy records with no stamp), a decision
beats no decision and Kept beats Dismissed. Cost: one extra file read per save.

**3. `refreshFromDisk()` on hub open and before each poll.** A stat; a read only
if the file moved. Without it a Mac left open all day keeps merging against an
ever-staler copy and keeps showing videos the phone hid hours ago.

Channels got the same treatment one level up: a merge unions two channel lists,
so `removeChannel` now leaves a `removedChannels` tombstone. Otherwise removing
a channel on the phone would have it handed straight back by the Mac.

**One hazard the fix itself introduced,** found and closed: a merge rebuilds the
items it reconciles, so a card rendered before a merge closes over an object no
longer in `state.items` — clicking dismiss on it would mutate an orphan and lose
the click. `SubscriptionsStore.live()` resolves an item by video ID at the
moment of the mutation; `hide`, `restore`, `openItem` and the duration backfill
all go through it.

## So future changes cannot break it again

- **`tests/merge.test.ts` — 20 tests, written as scenarios**, not field
  assertions: "the Mac's stale poll cannot un-hide what the phone just hid",
  "a hide survives any number of merges with a device that never learned of
  it", "a channel removed on one device stays removed". A change that
  reintroduces overwrite-on-save fails these before it reaches a device.
- **`install.sh` now runs `npm run check`, not `npm run build`.** Nothing gets
  installed into the vault unless the suite passes. That is the actual
  enforcement — the tests only help if they run every time.
- 240 unit tests total, build clean.

**What this still does not do:** it is a merge, not a sync engine. If both
devices are offline-editing the same video at the same moment, the later
timestamp wins and the earlier decision is lost — which is the right answer and
the only one available without a server. And it cannot help if iCloud itself
discards a copy before it syncs; a force-download of the vault on a device with
unsynced changes will still lose them.

---

## Acceptance criteria

- [x] A hide made on one device survives the other device's next save.
- [x] The same in both directions, and across repeated merges.
- [x] Putting a video back beats an older removal, and a newer removal beats an
      older restore.
- [x] Legacy tombstones with no timestamp are not overwritten by an undecided
      copy.
- [x] A description dropped by `hideItem` is not resurrected by a merge.
- [x] Descriptions, durations and Shorts flags fetched on one device reach the
      other.
- [x] A channel removed on one device stays removed.
- [x] A click on a card rendered before a merge still registers.
- [x] The regression suite runs on every install, not on request.
- [x] `npm run check` clean: 240 tests.

## Manual test (for BarkernotBob)

This one needs both devices, and the order matters.

1. On the **Mac**, open the hub and leave Obsidian running. Don't touch it
   again until step 4.
2. On the **phone**, hide four or five videos. Note their titles.
3. Wait a couple of minutes for iCloud, then on the phone check the **Hidden**
   filter — the four or five should be listed there.
4. Back on the **Mac**: open the hub. Within a few seconds the same videos
   should be **gone from the Inbox** and present under **Hidden**. (This is
   `refreshFromDisk` — before today the Mac would have shown them as new and
   then pushed them back to the phone.)
5. Press **Sync** on the Mac and wait for it to finish. The videos must stay
   hidden.
6. On the **phone**, pull the hub open again after a minute or two. They should
   still be hidden. **This is the test that failed before.**
7. Now the reverse: hide two videos **on the Mac**, wait, then open the hub on
   the phone. They should be hidden there too.
8. On the phone, take one hidden video and press the arrow to **put it back**.
   Check on the Mac after a minute — it should be back in the Inbox there too,
   not hidden again.
9. Open a video from the hub on the phone (making a note). On the Mac it should
   show as **Kept** rather than New.

If any step shows a video returning that you removed, say which step — that is
a merge rule being wrong, and the test that models it is in
`tests/merge.test.ts`.
