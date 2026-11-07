# V1 scope: fewer YouTube requests

**Written:** 2026-11-07, from Isaiah's ask of 2026-11-04 ("smart tests that are not likely to
trigger this … make sure those calls are smart as well") and his answer of 2026-11-07 ("I agree
with all the items you recommend"). Research: [RESEARCH-YOUTUBE-REQUESTS.md](RESEARCH-YOUTUBE-REQUESTS.md).

**Status:** Approved by Isaiah 2026-11-07. Part 1 built 2026-11-07, awaiting manual test. Covers GitHub #31–#39. Supersedes #16.

**Ground rule for all of it:** fewer and more consistent requests. No token generation, no
identity cycling, no proxies or IP rotation. No live probes from Isaiah's network while building;
every build step is checked with unit tests and recorded fixtures.

Built in four parts, one PR each, in this order. Each part is useful alone.

## Part 1: stop the bursts (#31, #39)

1. **Bot-check breaker (#31).** The first bot check or `LOGIN_REQUIRED` from any request opens
   a 45-minute cooldown on that device. During it: no subscription poll, no duration or feed
   backfill, no HD lookup, no automatic recovery retry, no auto transcript. Pressing Play still
   tries once (360p only). Stored on the device, so a plugin reload does not reset it.
2. **One message** while the cooldown runs, on the player's status line and in the hub header:
   "YouTube is asking this network to prove it isn't a bot. YT Free is pausing its requests
   until HH:MM." Not a Notice per request.
3. **Signed-in retry becomes a choice.** No automatic retry with cookies. During the cooldown
   the player offers "Try signed in" for that one video (desktop, when signed in).
4. **Smoke canary (#39).** `npm run smoke` becomes one video, yt-dlp only, one resolve and one
   range read, about 5 requests. A stamp file in `~/.cache/ytfree/` allows one run per 24 h;
   `npm run smoke -- --force` overrides. The other live tests move to Part 4's fixtures.
5. **Probes retired.** `tools/client-probe.mjs` and `tools/hls-probe.mjs` are deleted (their
   findings are in the scope docs). Other live tools in `tools/` get the same stamp guard and
   print their request count at the end.

Decided while building Part 1 (2026-11-07, Claude; open to change):
- `LOGIN_REQUIRED` pauses only when its reason is the bot check. Age-restricted and members-only
  videos answer `LOGIN_REQUIRED` too, and must not pause the plugin.
- On desktop, opening a video note is the "Play" that still tries once, because the desktop
  loads on open (item 12). It tries one yt-dlp client and does not fall back to InnerTube.
- The hub's Sync button and "Sync now" do nothing during the pause except say why: a poll is
  the biggest burst there is, pressed or not.
- The old full live suite is parked as `npm run smoke:full` (same daily limit) until Part 4.
- The remaining probe tools default to one video instead of two or three.

## Part 2: one answer per video (#32, #33, #35)

6. **Desktop: one `yt-dlp -J` per video (#32).** One call, kept until its URLs expire, feeds:
   360p (itag 18), HD (the stitched stream), captions and heatmap for the auto transcript,
   and the Smart Speed audio URL. No `-g` calls, no per-open client cycling (`FAST_CLIENTS`
   goes), and no InnerTube HD attempt on desktop. One yt-dlp client setting; changing it is a
   release, not a retry.
7. **Cost accepted:** the first frame waits for `-J` (about 2–3 s measured) instead of a pinned
   `-g`. "Resolving stream…" shows meanwhile, as today.
8. **No yt-dlp:** the desktop falls back to the phone path (one InnerTube call), as today.
9. **Phone: one player call per video (#33).** One ANDROID player response, kept until expiry,
   feeds 360p, captions and duration. IOS is asked only when HD on this phone is on. WEB stays
   for the heatmap and channel browse only. Feed-gap backfill keeps its WEB call for the publish
   date only if the channel `browse` result's date (relative, e.g. "3 days ago") turns out too
   coarse in fixtures; otherwise one player call per video, not two.
10. **Fewer range reads in HD (#35).** Index of the top rung and the sound up front; a lower
    rung's index only when hls.js first asks for that rung. One check at 90 s, on the top rung
    only. Target: about 5 reads per HD resolve, down from about 14.

## Part 3: remember and wait (#34, #36, #37)

11. **Answers survive reloads (#34).** The per-video answers from Part 2 are stored on the
    device (plugin data outside the vault, or `localStorage`), keyed by video ID, dropped at
    expiry. Reinstalling a build and reopening the same video sends nothing. Never in the vault:
    URLs are tied to the IP that asked.
12. **Desktop: one lookup on note open, nothing more (#34).** Isaiah asked on 2026-11-07 that HD
    be loaded and ready before he presses Play, so the desktop keeps resolving on open (a Play
    -only rule was dropped). The open spends exactly the one `yt-dlp -J` from Part 2 plus the
    ~5 HD range reads, and buffers HD. No second lookup, no client cycling, no extra probing.
    Trade-off: skimming ten new notes costs ten lookups; reopening any of them costs nothing
    (item 11). The phone keeps resolving on tap, as today.
13. **Request governor (#36).** Every YouTube request goes through one module: at most 2 in
    flight, 500 ms between player calls, background work capped at 60 requests an hour (Play is
    never capped, only queued). Command **"YT Free: Show YouTube requests this session"** lists
    counts by kind (player, yt-dlp, range read, feed).
14. **Background work (#37).** Only the desktop polls subscriptions when it has polled in the
    last 2 hours; otherwise the phone may. No poll on plugin load unless the last poll is older
    than the poll period. Duration backfill: 5 per poll, one at a time. Smart Speed: 3 ffmpeg
    connections instead of 6.

## Part 4: tests without YouTube (#38)

15. **Recorder.** `node tools/record-fixtures.mjs <videoId>`: human-run, guarded like the
    canary, saves the `yt-dlp -J` output, the ANDROID player response, and the first 64 KB plus
    `sidx` of each HD file to `tests/fixtures/`. URLs in fixtures are rewritten to a fake host.
16. **Replay tests.** 360p, HD stitching, captions, heatmap and the breaker run against those
    fixtures in `npm test`, with no network.
17. **Offline HD player.** A developer setting (hidden unless turned on in `data.json`) plays
    the stitched HD stream from a local MP4. Badge, buffering, scrubbing, the quality switch and
    Start in HD can be tested in Obsidian with no YouTube requests.

## Out of scope

- Anything that gets past a bot check rather than avoiding one (tokens, identities, proxies).
- Sharing resolved URLs between devices (they are IP-locked). Sharing captions and durations
  through the vault is a possible later step.
- Moving live tests to GitHub Actions (datacenter IPs are commonly bot-checked).

## Manual test (for Isaiah, after each part)

Part 1:
1. Nothing to do on a healthy network: videos play as before.
2. If YouTube flags the network again, open a video. The status line says YT Free is pausing its
   requests until a time about 45 minutes away. The hub shows the same line. Pressing Play tries
   once; on desktop, "Try signed in" appears.

Part 2:
3. Open a new video on the Mac. It starts within about 3 seconds, and the transcript lands in
   the note as before. HD climbs to 1080p as before.
4. On the iPhone, open a video and tap Play. It plays at 360p as before.

Part 3:
5. Open a video note on the Mac and don't press Play. Within a few seconds the badge shows HD
   ready. Press Play: it starts sharp.
6. Reload the plugin (or install a new build), reopen the same note and press Play. It starts
   at once.
7. Run **YT Free: Show YouTube requests this session**. Opening and playing one video shows
   about 1 yt-dlp call and a handful of range reads.

Part 4 needs no manual test beyond `npm test`, which I run.
