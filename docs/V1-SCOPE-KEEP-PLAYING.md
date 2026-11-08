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

## Part 2 (2026-11-07): a background pause stays resumable, and coming back lands on the video

Isaiah's test: playing in the background works. Two follow-ups:

### 5. Pausing in the background unloads the video after a few seconds

Cause (inferred, not measured): iOS suspends Obsidian a few seconds after its audio stops, and
WebKit lets go of the paused video with it, so an AirPods Play later finds nothing.

v1: when the video is paused while Obsidian is in the background (lock screen, AirPods, Control
Centre), a silent looping `<audio>` keeps the audio session open, so the app and the lock-screen
tile stay alive. It stops when the video plays again, when Obsidian comes back to the front, or
after an hour (`KEEPALIVE_MAX_MS`). Phone and tablet only. The silent element is unlocked on the
reader's first Play tap, because iOS refuses its first `play()` without a gesture.

Risks the test answers: iOS may still show a Pause button on the tile while the silence plays.
If it sends Pause for an AirPods tap that means Play, the handler treats it as Play.
Battery: an open audio session for up to an hour.

### 6. A Now playing button back to the playing note

Asked: tapping the lock-screen tile returns to the note that is playing. Not possible: iOS and macOS
do not tell the app which door it was opened through, so the tile and the app switcher look the
same. Isaiah chose a button over jumping on every return (2026-11-07).

v1: while a video is playing (or was paused from the lock screen/AirPods) and its note is open in
a tab that is not in front, a "▶ <title>" pill shows above the phone's bottom toolbar (desktop: in
the status bar). Tapping it brings that tab forward. Also a command, "Go to the playing video".
Hidden under an open Preview, which is already in front.

Changed 2026-11-07 (#51): the phone pill is removed at Isaiah's request. The phone keeps only the
command; the desktop keeps the status-bar item.

Not in v1: reopening a note whose tab was closed (the player stops with its tab).
