# V1 scope — switch quality for one video

**Written:** 2026-11-04, from Isaiah's ask:

> "In the player controls, I'd like a way to select on my video to do something different on
> video quality than my standard settings show. Essentially to go to 360p even if setting is HD,
> or to HD even if setting is 360p."

**Status:** Scoped and built 2026-11-04 on branch `claude/project-thread-mm476q`, stacked on
PR #21 (badge, Start in HD, desktop HD via yt-dlp). Awaiting manual test.

## In scope

1. **A "Quality" row in the player's pop-out** (the ⋯ panel marked "This video only"), first
   row, with two choices: `HD` and `360p`. It opens on whatever this video is using: the
   setting (desktop "Upgrade to high quality", phone "HD on this phone"), unless it was already
   changed for this video.
2. **360p while HD plays:** the 360p file is resolved and swapped in at the same second, still
   playing if it was. A pending HD lookup is dropped, and "Start in HD"'s wait ends at once.
   The badge reads `360p`; hovering says it was set for this video.
3. **HD while 360p plays:** the same upgrade as the setting does (badge `360p · finding HD…`,
   then the rung, then the top). If no HD comes, the badge settles on `360p` with the reason,
   as today. Switching to 360p and back to HD retries.
4. **Remembered for the video until Obsidian quits**, like the other pop-out controls (speed,
   Smart Speed, Pause while typing). Unpin/re-pin or reopening the note keeps the choice. It
   never writes a setting.
5. **Chosen before the video starts** (phone poster, or during "Waiting for HD…"): the load
   uses the choice.
6. **Downloaded copy:** the row is disabled, with "Playing the downloaded copy" on hover.

## Out of scope (backlog)

- Picking a specific rung (720p, 480p) or an Auto/manual ladder: GitHub #15.
- HD on the phone itself: GitHub #25. Until it lands, choosing HD on the phone shows
  `360p` with the reason on hover, the same as the phone setting would.
- Making the badge itself the control. The badge fades; the pop-out is where the
  per-video controls already live.

## Manual test (for Isaiah)

1. **Mac, HD setting on.** Open a video note and wait for the badge to show `1080p` (or the top
   rung). Open the ⋯ pop-out: Quality reads `HD`. Pick `360p`. Within a few seconds the picture
   softens at the same second, keeps playing, and the badge reads `360p`. Hover it: "360p,
   chosen for this video".
2. **Same video, pick `HD`.** The badge goes `360p · finding HD…`, then climbs to the top rung,
   without jumping position.
3. **Pin and unpin the player (or close and reopen the note).** The pop-out still reads what you
   last picked, and the video loads in it.
4. **Open a different video.** It follows the setting again.
5. **Settings → YT Free → turn "Upgrade to high quality" off.** Open a video: Quality reads
   `360p`, badge `360p`. Pick `HD`: it upgrades as in step 2.
6. **"Start in HD" on, HD on.** Open a new video and, while the status says "Waiting for HD…",
   pick `360p`. It starts at 360p right away instead of waiting.
7. **iPhone, HD on this phone off.** In a Preview, open ⋯ and pick `HD` before tapping the
   poster. It starts at 360p and tries HD (until #25 lands, the badge settles on `360p` with a
   reason on hover).
