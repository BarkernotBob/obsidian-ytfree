# V1 scope — see how HD is coming along, and start in HD

**Written:** 2026-10-22, from Isaiah's ask:

> "For the high quality video, I want a way to see where we're at in the buffer process, and a
> way to wait for high quality before starting the video rather than just having to wait it out
> at the beginning."

**Status:** Scoped and built 2026-10-22 on branch `claude/project-thread-sjrz45`, awaiting manual test.
The ~55s stutter and slow seeking are a separate piece of work ("Playback stutter and slow
seeking"), not this one.

## Why it is invisible today

The player starts on the 360p single file, asks for HD in the background, and swaps it in when
it arrives (`upgrade()` in `src/player.ts`). Once swapped, hls.js starts on a low rung of the
240p–1080p ladder and climbs as it measures bandwidth. None of those steps is shown, so the
first seconds are soft for no visible reason, and there is no way to say "don't start until it's
sharp".

## In scope

1. **A quality badge** on the picture's top-left corner (top-right is the phone Preview's ✕,
   the bottom is the native controls). Visible while anything is changing; once settled it stays
   4 seconds, then fades and comes back on hover:
   - `360p · finding HD…` while the HD resolve runs.
   - `480p · HD loading` (whatever rung is playing) after the swap, until the top rung plays.
   - `1080p` (or the video's top rung, e.g. `720p`) once the top rung is playing. No "loading".
   - `360p` alone when HD is off, unavailable for this video, or failed. Hovering says why.
   - Hidden for a local (downloaded) file.
2. **Buffered-ahead shading** on the purple progress line under the picture: a lighter band
   from the playhead to the end of what has loaded, like YouTube's grey bar. It shows how far
   ahead the player is fetched (the stitched stream keeps 30–60s ahead).
3. **"Start in HD" setting** (desktop under "Upgrade to high quality"; phone under "HD on this
   phone"). Off by default. When on:
   - The 360p and HD resolves run at the same time. Play waits for HD instead of starting at 360p,
     and HD starts on its top rung (no low-res climb at the start).
   - The status line says `Waiting for HD…` and the badge says `360p · finding HD…` while it waits.
   - If HD fails, or has not arrived within 15 seconds, it starts at 360p and keeps trying HD in
     the background the way it does today. Nothing waits forever.
   - A remembered position or a tapped timestamp still lands where it should.
4. **Jumps are unchanged**: a jump into unloaded video still starts its first chunk at the lowest
   rung and climbs back (Isaiah's rule of 2026-10-15). The badge shows that dip.

## Out of scope (backlog)

- A manual quality picker (GitHub #15). The badge is a readout, not a control.
- A percentage or progress bar for the HD resolve itself: it is a few network calls with no
  meaningful percentage, so it is shown as a stage, not a number.
- Making the 360p → HD swap seamless, the ~55s stutter and slow seeking: separate work.

## Manual test (for Isaiah)

1. **Mac, setting off (default).** Open a video note. The badge reads `360p · finding HD…`,
   top-left of the picture, then a rung with `HD loading`, then `1080p` (or the top rung), which
   fades after a few seconds and comes back when you hover the picture. On the thin purple line
   along the bottom of the picture, a lighter band runs ahead of the purple fill.
2. **Turn on Settings → YT Free → Start in HD.** Open a different video note, press Play. The
   status says `Waiting for HD…`; it starts a few seconds later already sharp, and the badge
   reads `1080p` from the start (no `HD loading`).
3. **Same setting, seek far ahead.** The badge dips (e.g. `240p · HD loading`) and climbs back.
4. **Phone (only with HD on this phone on).** Repeat 2 with "Start in HD" on: one tap on the
   poster starts it once HD is ready, no second tap.
5. **Settings off for HD entirely.** The badge reads `360p`, nothing waits.
