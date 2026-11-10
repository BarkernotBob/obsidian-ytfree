# V1 scope: one-tap toggle between our player and YouTube's

**Written:** 2026-11-10, from Isaiah's request that day: "I want it to be easier to jump back and
forth between YT player HD and the stream. Right now it's 3 clicks on phone to turn it on, then
you have to click play. … a one click button that stays in the same location that toggles you
between YT player and the stream player. That button should be on the controls bar. And it should
keep the video in the state it was in, playing if playing when clicked, paused if paused."

**Status:** Answers from Isaiah 2026-11-10: MVP; phone only (the desktop has yt-dlp for HD);
the button replaces "Back to our player"; on iPhone, a tap on YouTube's play button is accepted
only once a sound autoplay is shown to be impossible. Visual mockup reviewed in the thread.

## Today (main c4114a7)

- Into YouTube's player: phone only, ⋯ → Quality → "YouTube player (HD)" (3 taps). It always
  tries to autoplay, and on iPhone you then tap its play button.
- Out: a "Back to our player" text button replaces the whole bar; ours comes back paused.

## v1

1. **One button on the controls bar**, right-hand group, first in it. Icon + "YouTube" label on
   ours, "Our player" label while YouTube's is up. Same spot in both modes: while YouTube's
   player is up, our other controls are hidden with `visibility`, not removed, so nothing moves.
2. **Phone only.** On the desktop the button exists only while YouTube's player is up as the
   fallback tier (#43), as the way back ("Try our stream again").
3. **State is kept both ways.** Same second (±1 s, YouTube reports once a second), same speed,
   same playing/paused state.
   - Ours → YouTube, paused: YouTube's player opens cued at that second and does not start.
   - Ours → YouTube, playing: it starts. If iOS refuses sound autoplay from a tap outside the
     frame, try to fix it first (the old way in was a Quality `<select>`, which may not count as
     a tap; a muted start then unmute is the next thing to try). Only if neither works: YouTube's
     own play button shows and one tap starts it.
   - YouTube → ours: ours resumes at YouTube's second, playing if YouTube was playing (the tap
     is in our page, so autoplay is allowed). If ours had no stream yet (desktop resolves on
     Play), it resolves first, as Play does.
4. **The fallback case (#43)** keeps its meaning: when YouTube's player is up because our stream
   failed, the same button reads "Try our stream" and does what "Try our stream again" did.
5. **The Quality menu loses "YouTube player (HD)"**: the button replaces it.
6. No new request to YouTube: the toggle only mounts the existing hosted page
   (`docs/player/`), which gains a `play=0` parameter (cue, don't start).

## Not in v1

- Remembering "always use YouTube's player" per video or as a setting.
- Our speed picker driving YouTube's player while it is up (YouTube's own menu does it).

## Manual test

Phone (Obsidian iOS), any video note:

1. Tap Play on ours, wait for it to play. Tap **YouTube** on the bar. Expect: YouTube's player at
   the same second, playing (or its play button showing, see 3 above). The button stays where it was
   and now reads **Our player**.
2. Tap **Our player** while YouTube's is playing. Expect: ours at YouTube's second, playing.
3. Pause ours, tap **YouTube**. Expect: YouTube's player at that second, paused.
4. Pause YouTube's, tap **Our player**. Expect: ours at that second, paused.

Desktop: no YouTube button on the bar. Only when our stream fails and YouTube's player takes
over does it appear, and tapping it tries our stream again.

Until this is merged, GitHub Pages serves the old hosted page, which ignores `play=0`; the plugin
then pauses it as soon as it is ready, so step 3 may show a brief start.
