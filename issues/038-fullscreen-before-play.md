# 038 — Fullscreen pressed before playback starts

Status: **Built 2026-08-06 — not yet tested on the phone.** From BarkernotBob's manual test:

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

## How it was built

Three changes, in the order the issue asked for them.

**The instrumentation is the shipped answer, not scaffolding.** Settings →
Troubleshooting → "Log what the player is doing" prints, on every Fullscreen
press: `readyState`, `webkitSupportsFullscreen`, whether the native call was
made, and what `webkitDisplayingFullscreen` said 250 ms later. Off by default,
and it stays in — the failure it describes is silent by construction, so the
next time this is wrong the answer is a toggle rather than a guess. 041 uses the
same switch.

**Fullscreen stopped going through `withMedia`.** A warm player never awaited
there, which is exactly why Fullscreen worked mid-playback; a cold one awaited a
network round trip and the gesture was gone. Now the press decides first: warm,
or already fullscreen, and the call happens inside the tap with nothing in front
of it. That is the whole of the gesture half.

**A cold player is warmed at mount rather than at the first press.** The resolve
cannot be made to fit inside the tap that wants fullscreen, so the only way the
first press can be the real thing is for the resolve to have already happened.
`deferMobileLoad` now separates resolving from playing — the two used to be one
call, which made "there is loaded media" and "the video is playing" the same
event — and fetches the stream on mount while leaving the poster and the tap-to-
play exactly as they were. It is a setting ("Get the video ready when a note
opens", on, phone only), because "opening a note should not cost a video" is a
rule this bends, and someone on a metered connection should be able to bend it
back. `primeForGesture` gained the guard `withMedia` always had: `load()` on an
element that already has media restarts it, and since the warm-up that is the
ordinary state of a player nobody has played yet.

**And the fallback stopped being silent.** Landing in the CSS fullscreen is
reasonable; landing there without being told reads as a broken button. Both
routes into it now say so on the player's own status line — "Full screen in the
app", with what to do about it — and only where the native path exists, so the
desktop, where `requestFullscreen` works, is untouched.

What this does not do: make a cold press give *native* fullscreen with the
warm-up turned off. It cannot. With it off, a cold press starts the video and
gives the in-app fullscreen, and says which one it gave.

## Manual test (for BarkernotBob)

On the iPhone:

1. Open a video note you have **not** played. Wait a couple of seconds for the
   poster to settle, then press **Fullscreen** without pressing Play first.
2. You should get the phone's own fullscreen — the black screen with Apple's
   scrubber and the Done button — the same thing you get mid-playback.
3. Press Done. The player should be back in the note, at the position it was at.
4. Do 1–3 again in a **Preview** window.
5. Now play a video, and press Fullscreen mid-playback. Unchanged.
6. Turn the warm-up off (Settings → YT Free → "Get the video ready when a note
   opens") and repeat step 1. This time it should go fullscreen *in the app* —
   our version, with our buttons — and a line should appear on the picture
   telling you that is what happened. It should not fail silently, and it should
   not do nothing.
7. Turn it back on.
8. On the Mac, press Fullscreen in a note and in a Preview. Exactly as it was.
9. If anything above misbehaves: Settings → YT Free → Troubleshooting → "Log what
   the player is doing", reproduce it, and send me the console output.
