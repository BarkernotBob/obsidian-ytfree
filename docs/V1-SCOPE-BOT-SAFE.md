# V1 scope: near-zero bot checks for store users (#66)

**Written:** 2026-11-09, from Isaiah's MVP ask ("make the possibility of someone's IP getting
flagged close to 0") and his two clarifications the same day: low flagging exists so that users
stay on our own stream, never to move them to YouTube's player; and the desktop no longer loads HD
before Play ("I'm fine to cut that ask to reduce our requests"), but the badge must stop saying it
is finding HD when nothing is happening.

**Status:** Approved by Isaiah 2026-11-09 ("Go"), after a review of every request path
(section 0) and the feed torture tests (section 3). Built on PR #67. Builds on #31–#39 (merged:
[V1-SCOPE-REQUEST-BUDGET](V1-SCOPE-REQUEST-BUDGET.md)). Part of the store MVP (M12 in
[V1-SCOPE-MVP](V1-SCOPE-MVP.md)).

**Ground rule (unchanged):** fewer and steadier requests. No tokens, identity cycling, proxies or
IP rotation. No live probes from Isaiah's network; everything is checked with the replay fixtures.

**Not promisable:** a shared IP (VPN, school, carrier NAT) can be flagged by other people's
traffic, and Obsidian bans telemetry, so a flag in the field only reaches us as a bug report.

## 0. Review: savings to make before setting limits

Every YouTube request path in the code, checked 2026-11-09 on main (7a8493f). No live
measurement. Savings found, largest first:

| # | Where | Today | Saving |
|---|---|---|---|
| G1 | Smart Speed on desktop (`transcriptSilence`) | Asks InnerTube's ANDROID player for the caption list and downloads the caption file again, even though the `yt-dlp -J` from Play already has the list and the transcript fetched the same file | Read the list from the kept `-J` and keep the caption file per video: **−1 player call and −1 caption file per Play**, and one identity instead of two |
| G2 | Desktop HD start | 5 reads: two file openings, then each index again, then the 90 s check | The `sidx` index sits inside the 64 KB opening already read (about 1 KB in, measured on the synthetic files), so read it from there: **5 → 3 reads** |
| G3 | Desktop HD, 90 s check | 1 read per Play, guarding against files that stop at a minute | yt-dlp's files were measured serving the whole video (2026-11-04); the check was for InnerTube's. Drop it on the yt-dlp path: **3 → 2 reads**. Kept on the phone |
| G4 | Shorts check (desktop, every new hub video) | 1 request to `/shorts/<id>` per new video | A Short is at most 3 minutes. Ask only when the duration is known and ≤ 3 min: **most videos need no check** |
| G5 | Most-replayed backfill | 1 MB WEB call on note open; a video with no heatmap (most of them) is asked again every session its note is opened | Ask on Play, not on open, and remember "none" on the device: **at most once per video, ever** |
| G6 | Feed retries | Each failing feed is tried 4 times in a few seconds | Dropped: 3,710 feeds measured with no failure (§3) |
| G7 | Duration backfill | 1 player call per new hub video (the largest steady background cost) | Keep, under the hourly cap, newest first. A channel's Videos tab gives ~30 durations in 1 call, but that is a second identity (WEB); not worth it unless G-measurements say otherwise |
| G8 | `yt-dlp -J` internals | yt-dlp asks YouTube several times inside one run (page, player for its default clients) | Possibly pin one client and skip the page. **Needs one measured run** (about 3 requests) before deciding; not built in this scope |

Paths checked with no saving left: 360p on the phone (1 player call, kept), transcript on the phone
(same answer, +1 caption file), Preview's description and transcript (same kept answer), search and
channel pages (1 per page), recovery (1 fresh lookup). Thumbnails come from `i.ytimg.com`, an image
CDN, and are not counted; I found nothing suggesting they count toward bot checks.

## 1. Nothing before Play

1. Opening a note, a preview, or hovering a card sends **no** stream request on any device. The
   desktop resolves on Play, as the phone already does. (Reverses item 12 of the request-budget
   scope, at Isaiah's word.)
2. Before Play the quality badge shows nothing. After Play it says "360p · finding HD…" only
   while an HD lookup is actually running, and stops saying it the moment that lookup ends.
3. "Start in HD" still works: Play waits up to 15 s for HD, as today, then plays.

## 2. A ceiling per action, enforced by tests

The governor (#36) already counts every request by kind. Each action gets a written maximum, and a
replay test runs the action against the fixtures and fails CI if the count goes over:

| Action | Most YouTube requests |
|---|---|
| Open a note, preview, hover, scroll the hub | 0 |
| Play, desktop with yt-dlp | 1 yt-dlp run + 2 byte reads to start HD (then the video itself), transcript and Smart Speed included |
| Play, our own stream (phone, or desktop without yt-dlp) | 1 player call (+3 byte reads for phone HD when on) |
| Transcript of a video already played this session | 1 caption file (0 more for Smart Speed) |
| Transcript of a video not played | 1 player call + 1 caption file |
| Search, or one more page of it | 1 |
| Channel screen, or one more page of it | 1 |
| Recovery after a stream dies | 1 fresh lookup per video per Play |
| Takeout import of any size | 0 at import; then 1 feed per channel per poll (§3) |

## 3. Feeds: measured, no pacing needed

Isaiah asked to torture-test feeds before adding any pacing (2026-11-09). `tools/feed-torture.ts`
ran on his Mac on home Wi-Fi, with a video lookup (the call Play makes) after each scenario:

| Run | Scenario | Feeds | Failed | Slowest | Video lookup after |
|---|---|---|---|---|---|
| 18 channels | today, at once, 3× import, 30 min sustained, 1 feed ×100 | 298 | 0 | 640 ms | OK every time |
| 300 channels | 5 at a time | 300 | 0 | 243 ms | OK |
| 300 channels | all 300 at the same moment | 300 | 0 | 773 ms | OK |
| 300 channels | all at once, 3 times back to back | 900 | 0 | 2.7 s | OK |
| 300 channels | all at once every 5 min for 30 min | 1,800 | 0 | 1.3 s | OK |
| 300 channels | one feed 100 times, 20 at a time | 100 | 0 | 281 ms | OK |

3,710 feed requests in about an hour, no failure and no bot check. So feeds stay as they are: the
hourly poll and Sync now fetch every channel (5 at a time), with no spreading or stretching. The
hourly cap still does not count feeds. One home IP on one day; a shared IP (VPN, school) may differ.

## 4. When YouTube's player is used (needs #43)

7. Our stream stays the default everywhere. YouTube's player plays a video only when:
   - both stream tiers have failed for **that video** (yt-dlp, then our own stream, each tried
     once), or
   - YouTube actually answered with a bot check on this network, and only between retries
     (item 13). A Play that is due for a retry tries our stream first.
8. Never preemptively: not on a guess, not because a video is age-restricted, not as a setting
   default. A fall-through tries each stream tier at most once per video per Play.
9. This scope builds the rule (one function, tested) and hands it to #43, which builds the player.

## 4b. How long to pause after a bot check

13. 45 minutes was a pick, not a measurement: YouTube publishes no figure. Isaiah (2026-11-09):
    try again sooner. After a bot check our stream is tried again after 1 minute, then 5, 10, 30
    minutes, 1 hour, 2 hours, then every 6 hours, until one succeeds. A retry is spent only by a real
    Play (the next video the reader starts tries our stream once); no request goes out on a timer.
    Between retries Play uses YouTube's player (#43). Background work stays paused until a retry
    succeeds.

## 5. First-run defaults for store users

10. Unchanged: poll every 60 min, auto transcript on (it reuses the Play answer when there is one),
    Smart Speed on (desktop with ffmpeg, after Play, 3 connections).
11. Most-replayed stays on (Isaiah, 2026-11-09). It moves from note open to Play, and a video with
    none is remembered on the device (G5).
12. A fresh install with no subscriptions sends nothing until the first search, Play or import.

## Decided while building (Claude's calls, open to change)

- PR #70 (another session) had already added HD on Play, the ceiling tests and poll rounds. HD on
  Play and the tests stay; the rounds are removed, since section 3 measured no need for them. The
  poll is back to every 60 minutes, every channel.
- G1: caption files are shared in memory for the session (transcript and Smart Speed), not stored.
- G4: a video whose duration is not known yet is still checked for Shorts. Waiting for its
  duration (5 a poll) would leave Shorts showing in the hub after a big import. Only a known
  duration over 3 minutes skips the check.
- 4b: a bot check seen while still waiting (a request already in flight) does not move to the next
  wait. Until #43 lands, a Play between retries shows the pause message with the next retry time.
- Older builds stored a plain end time for the pause; it is honoured until it passes.

## Manual test (for Isaiah)

1. On the Mac, open a video note and don't press Play. The player shows the thumbnail and the
   badge says "HD on Play". Run **YT Free: Show YouTube requests this session**: no requests yet.
2. Press Play. The badge says "finding HD…" briefly, then climbs to 1080p. Run the command again:
   1 yt-dlp run and 2 video byte reads before playback (then the video itself).
3. Leave the note, open it again, press Play: no new yt-dlp run.
4. Open a few notes that have a transcript but no most-replayed section without playing them:
   nothing is sent. Play one: the section appears if the video has one.
5. Press the hub's refresh button: every channel is checked and the notice says how many.