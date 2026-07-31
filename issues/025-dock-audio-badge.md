# 025 — A ▶ on the dock icon while audio plays

Status: **Built and verified working 2026-07-31.**

Verified end to end by `ytfree:selftest-dock-badge`, which plays a real tone
through WebAudio and reads the real dock tile back:

| moment | `isCurrentlyAudible()` | dock badge |
|---|---|---|
| before | false | *(none)* |
| tone +1s | true | ▶ |
| tone +3.5s | true | ▶ |
| silence +3s | false | *(cleared)* |

macOS agrees: `lsappinfo info -only StatusLabel Obsidian` reports `"▶"` while
the tone plays and `""` after. What remains for a human is only step 6
(popped-out window) and step 10 (the phone).

Scope: [docs/V1-SCOPE-DOCK-BADGE.md](../docs/V1-SCOPE-DOCK-BADGE.md).

## The problem

Sound comes out of Obsidian and there is nothing on the outside of the app that
says so. With a note popped out into its own window, or the hub open behind
something else, finding what is playing means opening windows until the noise
stops.

## What was built

**`src/desktop/dock-badge.ts`** — a ▶ in the macOS dock badge for as long as
Obsidian is audible, gone within 2 s of it going quiet.

**The signal is `WebContents.isCurrentlyAudible()`, not our `<video>`.** Three
consequences, all of them wanted:

| | |
|---|---|
| Muted or volume-zero playback | reports false — no badge, which is what a person looking at a dock icon means by "playing" |
| PodNotes, RSS Dashboard, any other plugin's audio | lights the badge too. Accepted, and the reason is in the scope doc |
| A popped-out note, a `<webview>` | covered. Obsidian's popouts share a JS context but have their own `WebContents`, so a `play` listener on `document` would have missed exactly the case that motivated this |

**Instant in the common case, swept in the rest.** `audio-state-changed` on our
own renderer fires the moment our player or PodNotes starts, so the badge is
immediate; a 2 s sweep over `getAllWebContents()` is the backstop that catches
popouts and webviews. Every remote call is a synchronous IPC round trip, which
is why the sweep is 2 s and not 200 ms.

**Two rules about sharing one dock tile with other windows.** Each vault window
runs its own copy of the plugin and they all write the same tile:

- while audible, it writes on *every* sweep. Idempotent, so agreement is free —
  and when a closing window clears the badge out from under a window that is
  still playing, the second window puts it back within 2 s;
- when silent, it clears only a badge this instance set, so loading the plugin
  never wipes a badge that belongs to someone else.

**It lives in `src/desktop/`** and is reached through `await import("./desktop")`
like everything else that requires Node or Electron — the build guard in
`esbuild.config.mjs` now covers `@electron/remote` for this file too, so an
accidental top-level import fails the build instead of killing the plugin on
iOS. Off macOS `createDockAudioBadge()` returns null and nothing branches on it.

**A stale ▶ is reclaimed at startup.** Found while debugging the first "it is
not showing" report, and a real bug: the badge is process state, so a window
that is killed or a plugin reloaded mid-episode leaves a ▶ that the
"only clear our own" rule would have left on the Dock forever. `adopt()` runs
once at load and clears it — but only our exact glyph, and only while the app
is silent, because a ▶ with sound playing belongs to a window still using it.

**Two commands for when it does not work**, because every write in this file is
inside a `try` and macOS ignores a badge it dislikes without saying so:

- `YT Free: Diagnose the dock badge` — writes every link in the chain to
  `dock-diagnostics.json` in the plugin folder: platform, remote, the dock
  object, notification permission, `WebContents` count, audible count, and a
  test write it puts back afterwards.
- `YT Free: Self-test the dock badge (plays a tone)` — the end-to-end check
  above. The only link that cannot be proved without sound existing.

15 unit tests in `tests/dock-badge.test.ts`, 421 total, build clean.

## What the first failure turned out to be

Not the code, and not the two things that looked most likely. Recorded so the
next person does not re-run the search:

- **`dock.setBadge` does not need notification permission here**, despite the
  Electron docs saying "you need to ensure that your application has the
  permission to display notifications for this method to work". Obsidian has no
  entry in `com.apple.ncprefs` at all — it has never registered with
  Notification Center — and the badge displays regardless. Electron sets
  `NSDockTile.badgeLabel`, which is plain AppKit.
- **`@electron/remote` is fine.** `remote.app.dock` resolves, `setBadge` is a
  function, and the write throws nothing. Obsidian's main process calls
  `remote.initialize()` and `obsidian.asar` calls `remote.enable`.

Both were checked before anything was changed. `lsappinfo info -only
StatusLabel Obsidian` is the outside-the-app way to see the truth.

## What was not built

No setting, no composited icon, no Windows/Linux equivalent — see the scope doc.

## Acceptance criteria

- [ ] ▶ appears in the dock badge within ~2 s of audio starting in Obsidian.
- [ ] It disappears within ~2 s of the audio stopping.
- [ ] Muting playing audio removes it; unmuting brings it back.
- [ ] It appears for a non-YT-Free source (PodNotes) as well.
- [ ] Audio in a popped-out window is detected.
- [ ] Disabling YT Free mid-playback removes the badge and leaves nothing stuck.
- [ ] No badge, and no console error, on the phone.

## Manual test (for BarkernotBob)

Before you start: **Obsidian must be fully relaunched**, not just reloaded —
Settings → Community plugins → disable and re-enable "YT Free" is not enough on
its own for the first install, and the badge draws on the dock icon so Obsidian
needs to be in the Dock where you can see it.

1. Quit Obsidian completely (⌘Q) and reopen it.
2. Open any note with a YT Free video in it and press play.
3. **Look at the Obsidian icon in the Dock.** Within about two seconds a small
   red badge with a ▶ should appear at its top-right corner.
4. Pause the video. The badge should disappear within about two seconds.
5. Press play again, then mute the video with the volume control. The badge
   should go away while it is muted, and come back when you unmute.
6. Play the video, then drag that note out into its own window (right-click the
   tab → Move to new window) and play it there. The badge should still show.
7. Open a PodNotes episode and play it with no YT Free video running. The badge
   should appear for that too. **This is intended** — see the scope doc.
8. With something playing, go to Settings → Community plugins and turn YT Free
   off. The badge should vanish immediately and the audio-free dock icon should
   look completely normal.
9. Turn YT Free back on while audio is still playing from PodNotes. The badge
   should come back within a couple of seconds.
10. On the iPhone: open the vault, play a video, confirm the plugin still works
    and nothing has broken. There is no dock on a phone; this step is only
    checking that the desktop-only code did not follow you there.

If any step fails, the useful thing to capture is the desktop console:
⌘⌥I → Console tab, and copy anything red.
