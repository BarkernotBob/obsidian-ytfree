# 038 — Fullscreen pressed before playback starts

Status: **Scoped 2026-08-06 — not built.** From BarkernotBob's manual test:

> "Full screen is broken now too in preview and in a note."

and, narrowing it:

> "the fullscreen broken isn't across the board. It seems to only apply when I
> hit the full screen button before the video has already started playing."

That second sentence is the whole issue. Press Play first and Fullscreen works;
press Fullscreen from a cold player and it does not.

## The mechanism, which is already written down

[`player.ts`](../src/player.ts) says it in a comment above `enterFullscreen`:

> An iPhone has no element-level Fullscreen API at all — only the video's own
> `webkitEnterFullscreen`, and that one refuses until there is loaded media to
> show.

A cold player on mobile has no loaded media by construction. The stream is
resolved lazily — `ensureLoaded()` exists precisely because "until it has,
there is nothing for Play, PiP or Fullscreen to act on". So on a cold press:

1. `withMedia()` awaits `ensureLoaded()`, which does a network round trip to
   resolve the stream URL and assigns `video.src`.
2. `enterFullscreen()` runs. `requestFullscreen` does not exist on iOS, so it
   falls to the `webkitSupportsFullscreen` branch — and that flag is **false
   until metadata has loaded**. Assigning `src` is not loading metadata.
3. So it falls through to `setImmersive(true)`, the plugin's CSS fallback: the
   player lifted out of the note and laid over the screen. Which is not broken
   exactly — it is the wrong fullscreen, silently substituted for the real one.

**Two causes, and they need separating on a device before either is fixed:**

- **No loaded media.** `readyState` is 0, so the native API declines.
- **The user gesture is gone.** iOS only honours `webkitEnterFullscreen` inside
  the task that handled the tap. `await ensureLoaded()` on a cold player is a
  real network round trip, so by the time the call is made the gesture has
  expired. When the video is *already playing* the same await resolves in a
  microtask and the gesture survives — which is exactly the difference BarkernotBob
  observed.

The second is the more likely dominant cause and the harder one, because no
amount of waiting for metadata fixes a gesture that has already lapsed.

## How to approach it

Per the debugging rule, instrument before patching. Step one is a build that
logs, on a cold Fullscreen press on the phone: `readyState`,
`webkitSupportsFullscreen`, whether `webkitEnterFullscreen` was called, and
whether `webkitDisplayingFullscreen` was true 250 ms later. That distinguishes
the two causes in one tap.

Then, depending on what it says:

- **If it is metadata:** set `preload="metadata"` and start the resolve when the
  player mounts rather than on first press, so a cold player is only cold for
  the first second. Fullscreen then finds loaded media waiting.
- **If it is the gesture:** the call must happen inside the tap handler with no
  await in front of it. That means the stream has to already be resolved — same
  eager-resolve fix — and `enterFullscreen` must stop being reached through
  `withMedia()` on the path where media is already there.
- **If the native path genuinely cannot be reached cold:** say so in the UI
  rather than substituting silently. The immersive fallback is a reasonable
  thing to land in; landing in it without being told is not.

## Acceptance criteria

- [ ] On the iPhone, pressing Fullscreen on a player that has never played
      enters the same fullscreen as pressing it mid-playback.
- [ ] True in a note and in the Preview window.
- [ ] If the native fullscreen cannot be had, the immersive fallback is entered
      *and* the difference is visible to the user rather than silent.
- [ ] Exiting returns the player to where it was, at the position it was at, in
      both cases.
- [ ] Desktop fullscreen is unchanged.
- [ ] The instrumentation that found the cause is removed or left behind a debug
      setting, not shipped on.
- [ ] `tsc` clean, build clean, unit tests pass.

## Manual test (for BarkernotBob)

_Written when this is built._
