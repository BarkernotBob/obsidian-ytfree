# 021 — A way back, a line that lines up, and a Play button that never lies

Status: **Built 2026-07-30 — awaiting manual test.**

Five items off BarkernotBob's list.

> 1. Pinned player needs something that turns it back on too when hidden. Some
>    kind of UI element always visible on these types of notes only when the
>    video is hidden.
> 2. Remove the insert timestamp button.
> 3. The purple line should have the same padding on the left and right that the
>    main player progress bar has. This way, purple is always directly below the
>    main player line if both are present.
> 4. On mobile, if I click the video area at all, it should assume I want
>    left/right movement to be seeking through the video, rather than what it
>    often does now which is invoke the obsidian mobile left/right swipe gesture
>    commands.
> 5. If I immediately click the purple play button when a video hasn't yet
>    loaded, it will toggle the icon as if the video is playing, but the video
>    will not play, even once it's fully loaded. Then if I click the button again
>    it plays. This should NEVER false fire.

---

## 1. The way back

Read as: the **pin** is what hides it, and the pin lives on the control bar,
which goes away with the player. So the only route back was the command palette
— three taps and a search on a phone, with nothing on screen to suggest the
video was still there. (*Collapse* is a different thing and already has its own
"Show video" bar; that was left alone.)

Any note whose frontmatter points at a video now keeps a small **Player** pill
in the top corner, and only while the pinned player is off. Tapping it is the
same call as the pin and the command.

It is absolutely positioned inside `.view-content` — the box the editor's
scroller sits *in*, not the thing that scrolls — so it stays in the corner as
you read and costs the note **zero height**. Measured: the note's first line is
in the same place with the pill on the page as without it, on both shapes. On a
phone it drops below the floating view header (30 pt clear of it) so it never
sits under the "…" menu, and it is 34 pt tall there against 26 on the desktop.

## 2. The timestamp button is gone

Off the bar entirely. Timestamps still arrive two other ways — automatically as
you type (when *Timestamp every new line* is on) and from the **Insert
timestamp** command — and the settings copy now says so.

## 3. Sixteen pixels

Not guessed. Chromium's own `-webkit-media-controls-timeline` was screenshotted
at 400, 640 and 900 px wide and the pixels counted: the scrubber is inset
**exactly 16 px from each edge at every width** — it is not a percentage. The
purple line now uses the same inset, via `--ytfree-progress-inset` so it stays
tunable if a platform differs. Harness reports `progressInset: [16, 16]` at all
four widths.

Caveat worth knowing: this is measured against Chromium, which is what Obsidian
desktop and Android are. iOS Safari's inline scrubber may inset slightly
differently — if it looks off on the iPhone, that variable is the one dial.

## 4. Drag the picture to seek

Two halves.

**Taking the gesture back.** Obsidian's mobile swipe recognizer walks up from
whatever was touched and abandons the gesture at the first element with
`data-ignore-swipe` — that's how its own canvas opts out. The mobile player
wrapper now carries it, so a horizontal drag over the video no longer fires the
left/right navigation commands.

**Putting it to use.** A horizontal drag across the picture now scrubs: full
width of the picture = **90 seconds**, previewed live on the purple line with a
centred readout showing the target time and the offset (`12:04  +0:35`). It
commits on release — *one* seek, not sixty, which matters on a stream.

Deliberate limits: it takes 12 px of horizontal movement, and more horizontal
than vertical, before it claims the gesture, so a tap is still a tap and a
vertical drag still scrolls the note (`touch-action: pan-y`). The bottom 56 px
strip is left alone for the platform's own scrubber. Multi-touch is ignored.
Desktop is untouched — this is mobile only.

## 5. The Play button cannot lie now

Root cause, and it is in the HTML spec rather than in this plugin's logic:
calling `play()` on a `<video>` **with no source** sets `paused = false`,
rejects its promise, and fires no `pause` event. A later `load()` does not put
`paused` back while `readyState` is HAVE_NOTHING. The button painted itself
from the element's own events, so it went to "playing" and stayed there — and
the second tap "worked" only because it was read as a pause and reset the flag.

So the button no longer calls `play()` without a source. An early tap records
the **intent** instead: the button shows the pause icon and **pulses**, and its
label reads *Starting… tap again to cancel*. The moment the stream attaches —
or a local file finishes loading metadata, or the download swap happens — the
intent is honoured and it really plays.

The intent is cleared everywhere it could otherwise go stale: a second tap
cancels it, `pause()` clears it, and a stream that fails to resolve or recover
clears it along with the error message. Nothing is left waiting on a video that
is never coming.

---

## Acceptance criteria

- [x] A note with a video in its frontmatter shows a **Player** pill in the top
      corner whenever the pinned player is off, and never while it is on.
- [x] The pill adds no height to the note — measured, 0 pt on phone and desktop.
- [x] The pill stays inside the view and clear of the phone's floating header.
- [x] The pill is removed when the view closes and on plugin unload.
- [x] The timestamp button is gone from the control bar; the command and the
      auto-stamp still work, and the settings copy points at them.
- [x] The purple line is inset 16 px each side, matching the native scrubber —
      measured at 375 / 390 / 430 / 700 px.
- [x] The line still sits on the picture's bottom edge (0 pt) in every case,
      including immersive landscape.
- [x] A horizontal drag over the video on mobile does **not** trigger Obsidian's
      swipe navigation.
- [x] A horizontal drag seeks, previews on the purple line with a readout, and
      commits once on release.
- [x] A vertical drag still scrolls the note; a tap is still a tap; the native
      scrubber strip at the bottom is untouched.
- [x] Tapping Play before a video has loaded never shows "playing" without
      playing: it either plays when ready, or is cancelled by a second tap.
- [x] A pending play is cleared on failure, on recovery failure and on pause.
- [x] `npm run check` clean: 331 tests.

## Manual test (for BarkernotBob)

**The Player pill (both devices)**

1. Open a video note with the pinned player on. There should be **no** pill in
   the corner — the player is already there.
2. Tap the **pin** on the control bar to switch the pinned player off. A small
   **Player** pill should appear in the top-right corner of the note.
3. Scroll the note up and down. The pill must stay put in the corner, and the
   note's text must not have shifted down to make room for it.
4. On the phone, check the pill is *below* the header — it must not overlap the
   note title or the "…" menu.
5. Tap the pill. The pinned player should come back, and the pill should
   disappear.
6. Open a note with **no** video in its frontmatter. No pill at all.

**The timestamp button**

7. Look at the control bar on the desktop. The timestamp button is gone; that
   is intentional. Right-hand side should be: download, pin, pop-out.
8. Confirm timestamps still work: with *Timestamp every new line* on, type a new
   line in a note over a playing video. Also try the **Insert timestamp**
   command from the palette.

**The purple line**

9. Play a video and look at where the purple line starts and ends versus the
   video's own grey progress bar (hover/tap the picture to bring the native
   controls up). The two should start and end at **the same x**, purple directly
   under grey.
10. Check at a couple of window widths on the desktop, and on the phone.

**Drag to seek (phone only — this one matters most)**

11. Play a video. Drag your finger **left and right across the middle of the
    picture**. Obsidian must **not** flip to another note or pane.
12. While dragging, the purple line should move with your finger and a time
    readout should appear in the middle of the picture, showing the target time
    and how far you're moving (e.g. `12:04  +0:35`).
13. Lift your finger. The video should jump to that spot, once.
14. Drag a full picture-width across. That should be about **90 seconds**.
15. Drag **up and down** over the picture. The note should scroll as usual — no
    seeking.
16. Just **tap** the picture. That should behave as it always did (native
    controls), not seek.
17. Drag near the **very bottom** of the picture, where the native scrubber is.
    That should still be the video's own scrubber, not our drag.

**The Play button (this is the false-fire bug)**

18. Open a video note and, the *instant* it appears — before the video has
    loaded — tap the purple **Play** button.
19. The button should show pause and **pulse** (on the desktop its tooltip reads
    *Starting… tap again to cancel*). When the stream is ready the video should
    **actually start playing on its own**. It must never sit there showing
    "playing" while nothing plays.
20. Repeat, but tap the button a **second time** while it is pulsing. It should
    cancel — back to the play icon — and the video should **not** start when it
    loads.
21. Repeat on a note with a bad/expired video (or turn off wifi). You should get
    an error message and the button back on **play**, not stuck on pause.
