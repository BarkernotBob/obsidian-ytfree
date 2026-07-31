# v1 scope — the dock badge

Gate required before build. Written 2026-07-31. **Built 2026-07-31** — see
[issue 025](../issues/025-dock-audio-badge.md).

**One sentence:** while sound is coming out of Obsidian, its macOS dock icon
wears a ▶ badge, so the window playing it can be found without hunting.

**Smallest version a stranger gets value from:** a ▶ appears in the dock badge
area within a couple of seconds of audio starting anywhere inside Obsidian, and
goes away when the sound stops or is muted. No setting, no command, nothing to
turn on.

## Why this lives in YT Free rather than its own plugin

The badge is not a YouTube feature — it lights up for PodNotes and RSS Dashboard
too, because the signal it reads is "this process is making noise", not "our
player is running". A separate plugin would be the honest home for it.

BarkernotBob's call was to fold it in here anyway, and the reason it is defensible:
YT Free is already the plugin that plays long audio in the background, already
owns the desktop-only Electron surface (`src/desktop/`), and already has the one
thing this needs — a `@electron/remote` handle that has been proved to work in
this app. A second plugin would duplicate that whole apparatus to add fourteen
lines of logic.

The cost is recorded here so it is not discovered later: **disabling YT Free
disables the badge for every other plugin's audio too.** If that ever bites,
the module is deliberately free of YT Free imports and lifts out whole.

## Why an Electron badge and not something on the icon

macOS has no public API to put an overlay image on another app's dock tile, and
none to put an arbitrary image on your own — `setOverlayIcon` is Windows. The
two real options in Electron are:

- `dock.setBadge(text)` — the red pill in the corner. One call, and process
  state, so a crash cannot leave it stuck.
- `dock.setIcon(image)` — replaces the whole icon with a pre-composited PNG.
  Prettier, and it survives a crash *in the wrong way*: quit mid-playback and
  the icon stays wrong until the next launch resets it.

v1 is the badge. The composited icon is a v2 ticket and needs a setting.

## Not in v1

- Any setting. If the badge is unwanted, the answer for now is that it should
  not have been built.
- The composited-icon variant.
- Windows/Linux. `app.dock` does not exist off macOS; the module returns null
  and nothing else in the plugin notices.
- Showing *what* is playing (title, channel). The lock-screen Now Playing
  metadata already does that job — see `nowPlayingFor` in `main.ts`.
- Click-the-badge-to-reveal-the-window. Dock tiles are not clickable targets.

## Acceptance

1. Play a YT Free video → ▶ in the dock badge within 2 s.
2. Pause it → badge gone within 2 s.
3. Mute it while it plays → badge gone (muted is not audible).
4. Play a PodNotes episode → badge appears. That is correct, not a bug.
5. Disable YT Free while audio plays → badge gone, and no badge left behind.
6. Nothing on the phone, and no error in the console on the phone.
