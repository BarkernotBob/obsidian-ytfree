# V1 scope: near-zero bot checks for store users (#66)

**Written:** 2026-11-09, from Isaiah's MVP ask ("make the possibility of someone's IP getting
flagged close to 0") and his two clarifications the same day: low flagging exists so that users
stay on our own stream, never to move them to YouTube's player; and the desktop no longer loads HD
before Play ("I'm fine to cut that ask to reduce our requests"), but the badge must stop saying it
is finding HD when nothing is happening.

**Status:** Draft, revised 2026-11-09 after Isaiah asked for a review of every request path before
setting limits (section 0), and kept the most-replayed backfill on. Awaiting his approval. Builds on #31–#39 (merged:
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
| G6 | Feed retries | Each failing feed is tried 4 times in a few seconds | 2 tries; the next check covers the rest. Fewer bursts when YouTube's feed endpoint is having a bad hour |
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
| Takeout import of any size | 0 at import (feeds follow §3) |

## 3. No burst after a big import

Today every hourly poll fetches every channel's feed, 5 at a time: 300 channels is 300 requests in
about a minute, every hour, and a failing feed is tried 4 times. That burst is the pattern most
likely to look automated.

4. Feeds are spread out instead of all fetched in one poll: at most **one feed every 30 seconds**
   (120 an hour), oldest-checked channel first, with a little random jitter.
5. Each channel is checked every `max(poll period, channels × 30 s)`: with 60 channels that is the
   hourly poll as today; with 300 channels each is checked every 2.5 hours.
6. Shorts checks and duration lookups stay under the hourly background cap (#36). After an import
   they fill in over hours, not in one burst; cards show without a duration meanwhile.

## 4. When YouTube's player is used (needs #43)

7. Our stream stays the default everywhere. YouTube's player plays a video only when:
   - both stream tiers have failed for **that video** (yt-dlp, then our own stream, each tried
     once), or
   - YouTube actually answered with a bot check on this network, and only for the 45-minute
     breaker window. After it, streams are tried again.
8. Never preemptively: not on a guess, not because a video is age-restricted, not as a setting
   default. A fall-through tries each stream tier at most once per video per Play.
9. This scope builds the rule (one function, tested) and hands it to #43, which builds the player.

## 4b. How long to pause after a bot check

13. 45 minutes was a pick, not a measurement: YouTube publishes no figure, and the only data point
    is 2026-11-04, when continued requests kept Isaiah's IP flagged for most of a day. So the pause
    grows if YouTube is still refusing when it ends: 45 minutes, then 2 hours, then 6 hours, then
    back to 45 minutes after a clean day. Play during the pause still tries once (as today).

## 5. First-run defaults for store users

10. Unchanged: poll every 60 min, auto transcript on (it reuses the Play answer when there is one),
    Smart Speed on (desktop with ffmpeg, after Play, 3 connections).
11. Most-replayed stays on (Isaiah, 2026-11-09). It moves from note open to Play, and a video with
    none is remembered on the device (G5).
12. A fresh install with no subscriptions sends nothing until the first search, Play or import.

## Manual test (for Isaiah)

1. On the Mac, open a video note and don't press Play. The badge shows nothing. Run
   **YT Free: Show YouTube requests this session**: it says no requests to YouTube yet.
2. Press Play. The badge says "finding HD…" briefly, then climbs to 1080p. Run the command again:
   about 1 yt-dlp run and a handful of video byte reads.
3. Import a big Takeout CSV. Nothing is fetched at once; over the next hour the hub fills in about
   two channels a minute.
