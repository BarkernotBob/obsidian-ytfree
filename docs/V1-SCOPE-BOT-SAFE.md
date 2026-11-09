# V1 scope: near-zero bot checks for store users (#66)

**Written:** 2026-11-09, from Isaiah's MVP ask ("make the possibility of someone's IP getting
flagged close to 0") and his two clarifications the same day: low flagging exists so that users
stay on our own stream, never to move them to YouTube's player; and the desktop no longer loads HD
before Play ("I'm fine to cut that ask to reduce our requests"), but the badge must stop saying it
is finding HD when nothing is happening.

**Status:** Draft, awaiting Isaiah's approval. Builds on #31–#39 (merged:
[V1-SCOPE-REQUEST-BUDGET](V1-SCOPE-REQUEST-BUDGET.md)). Part of the store MVP (M12 in
[V1-SCOPE-MVP](V1-SCOPE-MVP.md)).

**Ground rule (unchanged):** fewer and steadier requests. No tokens, identity cycling, proxies or
IP rotation. No live probes from Isaiah's network; everything is checked with the replay fixtures.

**Not promisable:** a shared IP (VPN, school, carrier NAT) can be flagged by other people's
traffic, and Obsidian bans telemetry, so a flag in the field only reaches us as a bug report.

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
| Play, desktop with yt-dlp | 1 yt-dlp run + 5 byte reads to start HD (then the video itself) |
| Play, our own stream (phone, or desktop without yt-dlp) | 1 player call (+3 byte reads for phone HD when on) |
| Transcript of a video already played this session | 1 caption file |
| Transcript of a video not played | 1 player call + 1 caption file |
| Search, or one more page of it | 1 |
| Channel screen, or one more page of it | 1 |
| Recovery after a stream dies | 1 fresh lookup per video per Play |
| Takeout import of any size | 0 at import (feeds follow §3) |

## 3. No burst after a big import

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

## 5. First-run defaults for store users

10. Unchanged: poll every 60 min, auto transcript on (it reuses the Play answer when there is one),
    Smart Speed on (desktop with ffmpeg, after Play, 3 connections).
11. Changed: the most-replayed backfill on note open is **off** by default. It is a separate WEB
    identity and a 1 MB answer per note, sent on open. Notes made from now on still get the
    heatmap with their transcript; the setting can turn the backfill back on.
12. A fresh install with no subscriptions sends nothing until the first search, Play or import.

## Manual test (for Isaiah)

1. On the Mac, open a video note and don't press Play. The badge shows nothing. Run
   **YT Free: Show YouTube requests this session**: it says no requests to YouTube yet.
2. Press Play. The badge says "finding HD…" briefly, then climbs to 1080p. Run the command again:
   about 1 yt-dlp run and a handful of video byte reads.
3. Import a big Takeout CSV. Nothing is fetched at once; over the next hour the hub fills in about
   two channels a minute.
