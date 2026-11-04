# Research: fewer YouTube requests, in tests and in playback

2026-11-04. Research only, no code changed. Asked by Isaiah after his home IP got flagged
(yt-dlp "Sign in to confirm you're not a bot" on the Mac, `LOGIN_REQUIRED` on the iPhone on the
same Wi-Fi).

**Conclusion.** The flag most likely came from volume and identity spread, not from any one
feature. A single desktop HD open of a new video today costs up to **4 yt-dlp runs, 2 InnerTube
player calls under 2 different app identities, and about 28 googlevideo byte-range reads**, and
most of that is redundant: the same video's info is fetched 3 times, and the InnerTube HD
attempt is measured to fail on most videos anyway. On top of that, test builds reload the
plugin (which empties the stream cache and can start a subscription poll), and the smoke test
and probe tools sent tens to hundreds more requests per run, across 4 to 6 identities.

The fix is to ask YouTube **once per video, as one identity per device, cache the answer, and
stop when YouTube says stop**. Tests should replay recorded answers instead of asking live.

Scope: this is about sending fewer and more consistent requests. It is not about getting past
YouTube's checks: no token generation, no identity cycling, no proxies or IP rotation.

What is fact, inference and opinion below:
- **Fact**: counts read from the code on the integration build (PR #21 branch + #27 + #28).
- **Inference**: what YouTube counts. YouTube does not publish its rules. That "many app
  identities from one IP" and "bursts of parallel range reads" read as automation is the common
  experience of yt-dlp users, not something documented.

## 1. What one video open costs today (desktop, yt-dlp installed, HD on)

| Step | Where | Requests |
|---|---|---|
| Auto transcript (new notes only) | `harvestWithYtDlp` → `fetchVideoInfo` | 1 `yt-dlp -J` |
| 360p first frame | `desktopFast` → `resolveStream("fast")` | 1–3 `yt-dlp -g` (tv_simply, then web_safari, then default set) + 1 range read each (`servesBytes`) |
| HD, InnerTube attempt | `desktopQuality` → `resolveHdStream` | ANDROID player call, 6 index reads (5 rungs + audio), 2 reads at 90 s; on the usual 403 at 90 s, the same again as IOS |
| HD, yt-dlp attempt | `ytDlpFormats` → `resolveHdFromYtDlp` | 1 `yt-dlp -J`, 6 × 64 KB head reads, 6 index reads, 2 reads at 90 s |
| Smart Speed (first play) | `produceSilence` → `resolveAudioUrl` | 1 `yt-dlp -g`, then ffmpeg on 6 parallel connections |

Each `yt-dlp` run is itself several requests (watch page, player JS, one player call per client
in its set); exact count unmeasured. While the IP is flagged, `ytDlp()` runs each one twice
(signed out, then with cookies), so the flagged traffic doubles and is now tied to the account.

Opening the note resolves straight away on desktop (`player.load` at mount), not on Play. The
stream cache is in memory only (`StreamCache`), so a plugin reload, which every test build
install triggers, throws it away and the next open resolves again.

**Phone**: lighter. Nothing is fetched until Play (`deferMobileLoad`). 360p is 1 ANDROID player
call. Phone HD adds IOS then ANDROID player calls and the same ~8 range reads. Transcripts are
an ANDROID player call plus a WEB `next` call.

**Background**:
- Subscription poll: every channel's RSS feed, 5 at a time, up to 4 attempts each, hourly, and
  on every plugin load if the last poll is over 5 minutes old (`maybePoll(5)`). Both devices
  poll.
- Duration backfill: up to **40 ANDROID player calls per poll**, 4 at a time
  (`DURATION_BACKFILL_PER_POLL`).
- Feed-gap backfill: up to 5 WEB `browse` pages, then 2 player calls per found video under 2
  identities (ANDROID for details, WEB for the publish date).

**App identities in use from one home IP**: ANDROID, IOS, WEB (plugin); tv_simply, web_safari
and yt-dlp's default set (yt-dlp); ANDROID_VR, TV, Vision Pro and others (probe tools, now
retired). That spread is the part most likely to look like a bot.

## 2. What tests and tools cost today

- `npm run smoke` (`tests/live.smoke.ts`, `tests/channel.smoke.ts`): 17 live tests. About 6
  yt-dlp resolves (each up to 3 clients + a range read), 4 InnerTube calls as ANDROID and WEB,
  and a full HD resolve with deep checks as ANDROID and IOS. Project memory says to run it on
  the Mac before shipping, so every PR cycle sent this from the home IP.
- `tools/client-probe.mjs`, `tools/hls-probe.mjs`, `tools/hd-probe.ts`,
  `tools/ytdlp-hd-probe.ts`: 2–6 identities per video × several videos × reads at 0/30/60/90/180 s.
  These were the biggest single source on 2026-11-04.
- Manual test passes: each test build reloads the plugin, so each reopen is a fresh resolve.
- `npm test` (682 unit tests) is already offline. Fixtures exist for player responses, search
  and channel pages, but not for `yt-dlp -J` output or for file heads/indexes.

## 3. Recommendations for playback (in order of payoff)

**P1. One `yt-dlp -J` per video on desktop, shared by everything.** That one answer already
holds the 360p file (itag 18), the HD files, captions and the heatmap. Resolve it once, keep it
until its URLs expire, and derive the 360p stream, the HD stream, the transcript and the Smart
Speed audio URL from it. Removes 2–3 yt-dlp runs per new video. Costs: the first frame waits
for `-J` (measured "about 2–3 seconds" in the HD and transcript work) instead of a pinned `-g`.

**P2. Drop the InnerTube HD attempt on desktop.** It was measured on 2026-11-04 to stop serving
at about a minute on most videos, so it usually spends 2 identities and ~16 range reads before
yt-dlp is asked anyway. This also argues against GitHub #16 (InnerTube before yt-dlp for the
first frame), which would add an identity per open.

**P3. One identity per device.** Desktop: yt-dlp only, one client setting, no
tv_simply → web_safari → default cycling per open; if the pinned client breaks, change it in a
release, not per request. Phone: one InnerTube client for everything it can serve, with others
only where measured necessary (the WEB heatmap). Reuse one player response per video for 360p,
captions and duration rather than separate calls.

**P4. Stop on the first bot check (circuit breaker).** When YouTube answers with the bot check
or `LOGIN_REQUIRED`, pause all automatic YouTube requests from that device (polls, backfills,
prefetch, retries) for a cooldown, say 30–60 minutes, and show one clear message. Only an
explicit user action (pressing Play) is sent meanwhile. Make the signed-in retry a manual
choice, not automatic: today it doubles flagged traffic and puts the account's standing on it.

**P5. Persist resolved answers on the device, not in the vault.** Keep the `-J` / player
answers in plugin-local storage keyed by video ID until expiry, so a plugin reload or reopening
the same note costs nothing. Never in the vault: URLs are IP-locked (see `resolveMobileStream`).

**P6. Resolve on Play on desktop too**, or on Play plus "note visible for a few seconds". A
skim through ten notes should cost nothing, as on the phone.

**P7. Fewer range reads per HD resolve.** Read the top rung's and the sound's index up front;
read the lower rungs' indexes only when hls.js first asks for that rung. Keep the 90 s check on
one file (the top rung), not two. On yt-dlp's files, which were measured to serve the whole
video, consider dropping it.

**P8. One global request governor.** Route every YouTube request (InnerTube, yt-dlp spawn,
range reads) through one module: at most 2 in flight, a small spacing between player calls, an
hourly ceiling for background work, and a request counter visible in a debug command. This is
also what makes P1–P7 measurable.

**P9. Gentler background work.** One device polls subscriptions (the desktop when it is up; the
phone only if the last poll is stale by hours), no poll on plugin load unless the last one is
older than the poll period, duration backfill of 5 per poll at 1 in flight, and one player call
per backfilled video. Smart Speed: 2–3 ffmpeg connections instead of 6, since 6 exists to
outrun per-connection throttling.

## 4. Recommendations for tests

**T1. Record once, replay always.** A recorder (human-run, one video, one identity, rare) saves
the plugin's real answers as fixtures: `yt-dlp -J` output, player responses, and the first
64 KB plus the `sidx` box of each HD file. Unit tests for 360p, HD stitching, captions and
heatmap run against those. Extends what `tests/fixtures/` already does for player and search.

**T2. An offline player for UI tests.** A dev setting that serves the stitched HD stream from a
local MP4 (the virtual playlist's `fetchRange` is already injected), plus the existing local
copy path for 360p. Badge, buffering, scrubbing, quality switch and Start in HD can then be
tested in Obsidian with zero YouTube requests. Most manual passes this month were about these.

**T3. Shrink the smoke test to a budgeted canary.** One video, one identity (the one the plugin
uses), one resolve, one range read: about 5 requests. A stamp file allows at most one run per
day per machine unless forced. Everything else in `live.smoke.ts` moves to replayed fixtures.
Do not move live tests to GitHub Actions as the fix: datacenter IPs are commonly bot-checked by
YouTube (inference from yt-dlp's issue tracker), so it would fail for unrelated reasons.

**T4. Retire multi-client probing.** Mark `tools/client-probe.mjs` and `tools/hls-probe.mjs`
as retired, and give any remaining live tool the same budget guard as T3 and a printed request
count. No probe runs from Isaiah's network as part of routine work.

**T5. Test builds keep their cache.** With P5, reinstalling a build and reopening the same
video replays the stored answer instead of asking YouTube again.

## 5. Suggested order

P4 (breaker) and T3/T4 first: cheapest, and they stop the worst bursts. Then P1+P2+P3 together
(one `-J` per video, one identity), then P5, T1, T2. P6–P9 after. Each item is a backlog issue;
each needs a v1 scope before it is built.

| Item | Issue |
|---|---|
| P4 breaker | #31 |
| P1, P2, P3 desktop: one `-J`, one identity | #32 |
| P3 phone: one identity, one player call | #33 |
| P5, P6, T5 keep answers, resolve on Play | #34 |
| P7 fewer range reads | #35 |
| P8 request governor | #36 |
| P9 background work | #37 |
| T1, T2 replay fixtures, offline HD player | #38 |
| T3, T4 smoke canary, retire probes | #39 |

## Open questions

- How many requests one `yt-dlp -J` makes with the default client set. Measurable offline-ish
  with `yt-dlp -v --simulate` once the flag clears, one video, one run.
- Whether the iPhone's Obsidian can share the Mac's resolved answers (it cannot share URLs, which
  are IP-locked; it could share captions and durations through the vault, which are not).
