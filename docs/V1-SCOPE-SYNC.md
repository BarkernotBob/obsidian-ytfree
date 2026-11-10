# V1 scope: hub and watch time stay in sync between devices

Asked 2026-11-09 (Isaiah): about 1 in 10 hub Removes reappears on the other device, and it
can take 3-4 removals across devices before it stays gone. Expectation: as long as two devices
are not edited within ~10 seconds of each other, they agree exactly on video status and watch
time. Triaged MVP (a bug in a shipped feature). Fix approved 2026-11-09 14:27Z.

## Root cause

The merge (`mergeStates`, `mergeProgress`) is right. What is missing is any way for a decision
to survive its one write being lost:

- Sync tools replace whole files. If both devices write `subscriptions.json` before either has
  received the other's copy, one copy wins and the other is dropped (iCloud keeps the newest;
  Google Drive, Dropbox and Syncthing may keep the loser as a conflict copy nobody reads).
- The device that made the Remove keeps it in memory, but a refresh only reads the file. It
  never writes back what the file is missing, so the other device never learns it.
- When iOS kills Obsidian, that memory is gone and the Remove is lost on both devices.
- `progress.json` still writes over a file it could not read (the hole 034 closed for the hub),
  and a finished video's cleared position cannot cross devices (no tombstone).

Inferred from the code, not reproduced live. Isaiah's vault had no conflict copies, which fits
iCloud silently keeping one copy.

## v1

One helper, `src/synced-file.ts`, used by `subscriptions.json` and `progress.json` (and offered
to `history.json`, GitHub #48):

1. **Write back what the file is missing.** Every read merges the file into memory; if the
   merged result means something the file does not, the device saves. Compared by meaning
   (sorted, key-order-free), so two devices never rewrite the file back and forth.
2. **Device-local copy.** Each local change is also kept in the app's local storage (not
   synced) and merged back in at load, so an app kill cannot lose it.
3. **Never write over an unreadable file** (now for progress too), and **skip writes that
   would not change the file's meaning**.
4. **Conflict copies.** `subscriptions 2.json`, `subscriptions (1).json`,
   `subscriptions (… conflicted copy …).json`, `subscriptions.sync-conflict-….json` are merged
   in, then deleted once a write containing them has landed.
5. **Check sooner.** Re-read on window focus / app foreground, and every 5 s while the hub is
   open (a timestamp check; the file is read only when it changed). Was 20 s.
6. **Watch time:** a finished video leaves a dated "cleared" mark so the other device's older
   position cannot bring it back.

No YouTube requests are added or moved; this is local file I/O only.

## Tests

`tests/sync-sim.test.ts`: two simulated devices on a simulated sync service that delivers
late, keeps one copy on collision (or makes a conflict copy), returns unreadable files, and
kills/relaunches the app. Random Remove/Keep/Restore/watch sequences with actions ≥10 s apart:
nothing removed comes back, and both devices end identical once the service delivers.

## Not in v1 (filed as issues)

- Sync files live in the hidden `.obsidian/plugins/ytfree/` folder. Obsidian Sync copies it only
  with "Installed community plugins" on, and some Google Drive / phone sync apps skip hidden
  folders. Store README note now; moving the files to a visible folder is post-MVP.
- A guarantee of 10 s: delivery time belongs to the sync service. Once the file arrives, the
  hub shows it within 5 s.

## Manual test (Mac + iPhone, same iCloud vault)

1. Open the hub on both devices. On the Mac, Remove a video in the Inbox.
2. Within about a minute (iCloud), the iPhone hub drops it without touching anything.
3. On the iPhone, Remove a different video, then swipe Obsidian away (force-quit) right away.
   Reopen it: the video is still removed, and the Mac drops it within about a minute.
4. Remove five videos on the iPhone, one every ~15 s, while the Mac sits on the hub. None of
   them reappears on either device over the next 5 minutes.
5. Play a video on the Mac to 3:00, pause. Open its note on the iPhone: it resumes at ~3:00.
   Play it to the end on the iPhone. Reopen it on the Mac: it starts from 0:00, not 3:00.
