# 025 — A ▶ on the dock icon while audio plays

Status: **Built 2026-07-31 — awaiting manual test.**

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

10 unit tests in `tests/dock-badge.test.ts`, 402 total, build clean.

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
