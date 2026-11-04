# V1 scope — the phone keeps playing (2026-11-04)

Isaiah's ask: on the phone, the video does not pause when he

1. leaves fullscreen back into the note,
2. taps the collapse button that hides the picture,
3. leaves Obsidian without closing it,
4. locks the phone.

## What pauses today, and the change

| Case | Cause today | v1 change |
|---|---|---|
| Collapse | `toggleCollapse` called `pause()` on purpose (old decision: "you are putting the video away") | Removed. Collapse hides the picture and the sound carries on, like the section buttons' fold already did. The video is clipped, not `display: none`, so iOS keeps it playing. |
| Leave fullscreen | iOS pauses the `<video>` itself when its native fullscreen closes | A pause within 1 s of `webkitendfullscreen` / presentation mode leaving fullscreen / `fullscreenchange` is resumed. |
| Leave Obsidian, lock | iOS pauses the `<video>` when the app goes to the background | A pause within 1 s of the document going hidden is resumed with `play()`. |

A pause the reader asked for (our Play button, the player's `pause()`, the lock screen's Pause)
stamps itself first and is never resumed. Typing pauses and the end of the video are left alone.
Pure rule: `src/keep-playing.ts`, tested in `tests/keep-playing.test.ts`.

## The open question (cases 3 and 4)

Whether WebKit inside the Obsidian iOS app accepts a `play()` while the app is in the background
is not known. That is the same question `spikes/lock-audio` (GitHub #26) asks, and nobody has run it.
This build answers it directly: if the sound keeps going after locking, it works. If iOS refuses,
the pause stands exactly as before (the background guard still stops WebKit's surprise resume on
the way back), and the lock screen's Play still resumes by hand.

If it is refused, the next things to try, each its own issue: auto Picture-in-Picture when leaving
the app, or handing off to an audio-only element. Both depend on the same WebKit behaviour.

## Not in v1

- A setting to turn this off. Add one if anyone asks.
- Leaving Picture-in-Picture with its close button still stops playback (that is a stop, by design).
- Edge: pausing with the iPhone's own fullscreen controls and then tapping ✕ within a second resumes.
  The native controls do not tell us who pressed them.
