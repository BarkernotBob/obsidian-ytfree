# 043 — Full quality on the desktop (above 360p), signed out

**Status:** Backlog, scoped 2026-08-17. **Not built.** Asked for by BarkernotBob after
the 2026-08-17 outage:

> "Add the teaching of the player to play 2 files at once as a backlog item to
> revisit later."

**Created:** 2026-08-17

## Problem

The desktop player plays **one file**, so it gets the only all-in-one format
YouTube still offers: itag 18, 640×360. Everything above that exists as a
**separate picture file and sound file**.

Until 2026-08-17 this did not bite, because a third thing filled the gap: an
HLS "quality ladder" stream that `upgrade()` swapped in a few seconds after
playback started. Signed out, that has all but disappeared — measured the same
day, one video in five still offered an HLS manifest. So the upgrade almost
never fires now and the desktop sits at 360p, on a window far larger than the
phone's.

This is [005](005-mobile-full-quality.md) again, for the other platform and for
a different reason. The two want the same machinery.

## What the measurements establish (2026-08-17)

Anonymous, no cookie file, one range request per URL:

| what | result |
| --- | --- |
| all-in-one 360p (itag 18, `tv_simply`) | serves, 206 |
| separate picture ≤1080p (default clients) | serves, 206 |
| separate sound (default clients) | serves, 206 |
| HLS ladder, signed out | 1 video in 5 |
| HLS ladder, with the account cookie file | every video tried |

So HD is reachable without an account today. What is missing is a player that
can hold two streams at once.

**Explicitly out of scope: signing in.** Passing `--cookies` to the resolve
would restore the HLS ladder immediately, and BarkernotBob has ruled it out — he does
not want the YouTube account tied to playback. Anything built here stays
anonymous.

## What it should do

**Feed the `<video>` element the picture and the sound as two streams, through
Media Source Extensions**, the way youtube.com itself does.

- Resolve the two URLs with one yt-dlp call rather than two (`-f
  "bv*[height<=?1080]+ba"` prints both, in order).
- Build a manifest locally — yt-dlp can emit the numbers needed — and drive it
  with a DASH player, or append the byte ranges by hand through MSE. Which of
  the two is a spike, not a decision to make on paper.
- `hls.js` is already bundled and already owns the "swap the source without
  disturbing playback" path (`attach`, `upgraded`, `recovering`); a second
  source type should join that path rather than growing a parallel one.
- Keep 360p as the thing that starts first. First frame fast, quality after —
  that is the existing shape and it is the right one.
- Fall back silently. A video with no adaptive pair, an MSE failure, a codec the
  build cannot decode: stay on 360p, do not interrupt, do not show an error.

## Acceptance criteria

1. A video with a 1080p adaptive pair plays at 1080p on the desktop, signed out,
   with no cookie file present.
2. Playback still starts at 360p within the current time-to-first-frame, and the
   swap to HD does not restart, reseek, mute, or change the speed of what is
   playing (the `attach` contract).
3. Sound and picture stay in sync across a seek, a speed change, and a pause of
   at least a minute.
4. A video with no adaptive pair, or an MSE/codec failure at any point, leaves
   the 360p stream playing and reports nothing to the user.
5. Smart Speed, skip-non-speech, the progress line and position recording all
   behave exactly as they do on the 360p stream.
6. Nothing in this path sends the account cookie file.
7. The live smoke test gains a case that proves the two adaptive URLs still
   serve anonymously — the same class of check that caught the 2026-08-17
   outage.

## Manual test (for BarkernotBob)

To be written when this is built, per the repo rule — a numbered plain-English
walk-through, including one video with readable on-screen text so the difference
between 360p and 1080p is obvious.

## Notes

- Mobile is [005](005-mobile-full-quality.md) and stays separate: iOS Safari's
  MSE support is the reason that one was parked, and it may still be.
- Downloading a video already gives full quality today (yt-dlp merges the pair
  with ffmpeg, and `swapToLocal` swaps the playing video onto the local file).
  That is the workaround until this is built, and it is worth saying out loud in
  whatever prompted this issue.
