# 034 — State that disagrees between devices

Two reports, one file:

> Things are getting out of sync on removing videos between mobile and desktop.
> I can remove on one then not see the change on the other even when the sync
> button is pressed.

> Watched videos get removed from kept.

## What was wrong

Issue 014 made a save a merge instead of an overwrite, and that merge is right —
`tests/merge.test.ts` is twenty-odd scenarios proving it. The merge was never
the problem. What was wrong is the plumbing around it: **three separate ways for
a correct merge to produce a wrong screen.**

1. **A save that could not read the file overwrote it anyway.** `readDisk`
   returned `null` for two different things — "there is no file" and "there is a
   file I could not read" — and `save` could only ask whether it got a state. So
   a failed read skipped the merge and wrote this device's entire snapshot over
   the top, which is 014's bug with an extra condition on it. On a vault in
   iCloud a failed read is routine: an evicted file, a partial download, a copy
   caught mid-replacement — and every one of those happens *precisely* when the
   other device's decisions are in flight towards this one. A removal made on
   the phone thirty seconds ago lives only in that file.

2. **A failed read still counted as having read the file.** `refreshFromDisk`
   skips the read when the file's mtime matches the last one it saw, and it
   stamped that mtime *before* reading. One failed read therefore marked that
   version permanently seen, and the device never looked at it again — a
   momentary blip turning into an indefinite disagreement. This is why pressing
   sync could keep not working.

3. **The hub merged correctly and then did not redraw.** `HubView.onOpen`
   subscribed to the store and redrew the status line, the channel list and the
   menu label — but never the list of videos. Deliberately: a local click has
   already swapped its own card, and rebuilding the grid under the finger that
   clicked it breaks the no-reflow rule. But a change arriving from the *other*
   device has no card to swap. So the removals crossed, the state was right, and
   the screen went on showing the removed video — indistinguishable, from the
   outside, from the sync having failed.

And separately, the second report. **Anything Obsidian called a deleted note
took the video out of Kept** — permanently, on both devices, because `forget`
writes a tombstone every device honours. The handler was registered at `onload`
with no check that the file was really gone, so three innocent things triggered
it:

- **Startup on an iCloud vault.** Notes arrive as they download; ones that had
  not arrived yet read as deleted. (`vault.on("create")` two blocks up is
  already wrapped in `onLayoutReady` for exactly this reason.)
- **The plugin's own tidy sweep.** `tidyEmptyNotes` trashes watched notes with
  nothing written in them, which fires the same event — so tidying a note threw
  its video away. Issue 018 says the opposite: the item stays Kept with a
  `notePath` pointing at nothing, and `openItem` re-creates the note on demand.
- **A file being replaced rather than removed**, which iCloud does as a delete
  followed by a create.

Symptom two is therefore *"watched videos get removed from Kept"* almost
literally: being watched is what makes a note eligible for tidying, and tidying
is what removed it.

## What it does now

- `readDisk` answers `state`, `absent` or `unreadable` — three cases, so the
  callers can stop guessing. The decisions on top of it are pure and live in
  `src/state-sync.ts`, which lets a test drive them with a disk that fails on
  command; the real failure needs an iCloud sync to land inside the few
  milliseconds of a save.
- **A save never writes over a file it could not read.** It retries the read
  twice with a short backoff — the failures are milliseconds long — and if it
  still cannot read it, it writes nothing and tries again in twenty seconds. The
  change is still in memory, so nothing is lost: a save deferred costs seconds, a
  save over an unread file costs the other device's decisions.
- **A refresh advances its watermark only after a read that answered.**
- **The hub redraws its list when, and only when, a change came from the other
  device.** The store's listeners are told *why* they are being notified
  (`ChangeReason`), so local clicks still do not reflow. The redraw keeps the
  scroll depth: a merge means "the list you are looking at was slightly wrong",
  not "start again from the top".
- **An open hub re-reads the file every 20 seconds.** The poll is hourly, which
  is right for asking YouTube what is new and far too long for noticing that the
  phone removed something a minute ago.
- **The sync button refreshes from disk first**, before it talks to YouTube —
  because "agree with my other device" is what pressing it means, and that
  answer is already in the vault.
- **A note has to be really gone to lose its video.** The `deleted` handler is
  registered after layout, ignores paths the tidy sweep just trashed, and waits
  five seconds before writing a tombstone — if something occupies the path
  again, the note moved rather than left. A deliberate delete still removes the
  video from the hub, which is issue 026 and unchanged.

Nothing new is written into `subscriptions.json`. The fix is entirely in when
the file is read and written, so **existing state files load and save exactly as
before and no migration is needed** — including files written by the version
before this one, on the other device, during the same iCloud sync.

## Acceptance criteria

- [x] A save whose read of the state file fails writes nothing, and the change
      it was carrying survives to the next save.
- [x] A failed read does not mark that version of the file as seen; the next
      refresh still picks it up.
- [x] A removal made on one device survives the other device saving a snapshot
      taken before it, and does not come back on either.
- [x] A change arriving from the other device redraws the hub's list; a local
      click still does not.
- [x] An open hub picks up the other device's changes within about 20 seconds
      without anything being clicked.
- [x] Tidying an empty watched note leaves its video in Kept (issue 018's
      stated behaviour).
- [x] Notes that have not finished downloading at startup do not remove their
      videos from the hub.
- [x] Deliberately deleting a video note still removes it from the hub
      (issue 026 still holds).
- [x] `subscriptions.json` gains no fields; a file from the previous version
      loads and round-trips without losing tombstones.
- [x] 435 unit tests pass; `tsc` clean; build clean.

## Manual test (for BarkernotBob)

You need both machines for this: the Mac and the iPhone, both with the vault
synced and the plugin installed on each.

**A removal crosses, without pressing anything (1, 3)**

1. On the **Mac**, open the YT Free hub and leave it open on the **Inbox** tab.
   Note the first three videos.
2. On the **iPhone**, open the hub, find one of those three, and press
   **Remove**.
3. Put the phone down and watch the Mac. Within about half a minute the video
   should disappear from the Mac's list on its own — no clicking, no sync
   button, no reopening the tab.
4. Check the Mac's **Removed** tab: the video should be in it.

**And the other way (1, 3)**

5. On the **Mac**, remove a different video.
6. On the **iPhone**, with the hub already open, wait. It should vanish there
   too within about half a minute.

**The sync button (2)**

7. On the **iPhone**, remove one more video, then immediately force-quit
   Obsidian on the phone (swipe it away) so it has no chance to do anything
   else.
8. On the **Mac**, press the **sync** button in the hub toolbar. The video
   should be gone by the time the button finishes.

**Nothing comes back (1)**

9. Quit Obsidian on the **Mac** entirely.
10. On the **iPhone**, remove three or four videos over a couple of minutes.
11. Re-open Obsidian on the **Mac** and go to the hub. All of them should still
    be gone. None should reappear a minute later, after the Mac's first poll —
    that is the case that used to fail.
12. Go back to the **iPhone** and check the same list. Still gone.

**Kept survives being watched and tidied (the second report)**

13. On either device, open a video from the hub so it gets a note, and watch
    enough of it that it counts as watched. Write nothing in the note.
14. Check the **Kept** tab: the video is there.
15. Leave it for longer than Settings → YT Free → *tidy empty notes after* (in
    days), or run the command *YT Free: Tidy empty video notes* to force it.
    The note is moved to the trash and a notice says so.
16. Check **Kept** again — on both devices. **The video should still be
    listed.** Press it: the note is re-created and opens.
17. Now delete a different video's note yourself, from the file explorer. Wait
    ten seconds. That one *should* leave the hub, on both devices — that is
    issue 026 and it still works.

**Nothing is lost on the first launch (backwards compatibility)**

18. Before installing this build, note roughly how many videos are in Inbox,
    Kept and Removed on the Mac.
19. Install it, restart Obsidian, and check the three counts. They should be
    the same. Nothing should be empty and nothing should have come back.
20. Do the same on the iPhone, and specifically watch the **Kept** tab during
    the first thirty seconds after launch, while iCloud is still pulling notes
    down. It should not shrink.
