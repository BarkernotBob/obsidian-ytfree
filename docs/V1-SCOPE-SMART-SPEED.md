# v1 scope — Smart Speed (silence compression)

Gate required before build. Written 2026-07-29.

**One sentence:** like Overcast's Smart Speed — pauses in speech play fast, speech plays
at the user's chosen speed, and it works out of the box with nothing installed; ffmpeg,
if present, silently upgrades the accuracy.

**Smallest version a stranger gets value from:** a Smart Speed toggle in the player
controls that, on any captioned video, compresses the pauses using caption timing alone —
no ffmpeg, no downloads, no setup, desktop **and** mobile. A running "time saved" readout
proves it is working.

## The hard requirement: piecemeal, or it doesn't ship

This plugin is meant to be shareable. A stranger installs it from the community list and
gets Smart Speed working with **zero external dependencies**. ffmpeg is an *enhancer*:
if the resolver finds it, maps get more accurate; if not, nothing is missing, broken, or
nagging. **If any part of the design only works with ffmpeg installed, that part is not
v1.** This is the same posture yt-dlp already has in this plugin (mobile never has it;
desktop works without it for streaming).

## The design: one engine, swappable map producers

A **silence map** is a sorted list of `[start, end]` second-windows where nothing worth
hearing happens. Everything splits into producers (make a map) and one apply layer
(use a map). The apply layer never knows which producer fed it.

```
transcript producer (no deps, both platforms)  ┐
ffmpeg producer (desktop, only if installed)   ├─→ silence map ─→ apply layer (player.ts)
synced map from the other device               ┘
```

Why this shape and not Skip Silence's real-time analyser: **measured 2026-07-29**, the
Web Audio route is closed. `createMediaElementSource` on our cross-origin googlevideo
`<video>` outputs zeroes (CORS tainting), and googlevideo only sends
`Access-Control-Allow-Origin` to whitelisted origins:

| curl with header | ACAO in response |
|---|---|
| `Origin: app://obsidian.md` | none |
| `Origin: https://www.youtube.com` | `Access-Control-Allow-Origin: https://www.youtube.com` |

Adding `crossOrigin="anonymous"` to the `<video>` would therefore kill playback outright.
Skip Silence survives on youtube.com only because YouTube's own player uses same-origin
MSE blob URLs. A localhost proxy could un-taint the element on desktop, but it is more
machinery, desktop-only forever, and buys nothing the map design doesn't — it becomes the
v2 route *if* a real-time-only feature (Voice Boost) ever justifies it.

## Apply layer (`player.ts`)

- A rAF loop while playing (timeupdate at ~250 ms is too coarse): current time inside a
  window → `playbackRate` = silence speed; outside → the user's chosen speed. Pure
  decision function `(t, map, baseRate, silenceRate) → rate`, unit-tested.
- Silence speed is `max(baseRate, silenceSpeed setting)` — speeding *up* speech-speed
  never slows a pause down.
- `preservesPitch = true` set explicitly (plus `webkitPreservesPitch` for iOS) so 3×
  pauses don't chipmunk.
- Toggle lives in the existing control row. **Per the layout rule: the toggle reserves
  its space whether the feature is available or not — availability changes appearance
  (dimmed), never geometry.** Same for the time-saved readout: fixed-width slot.
- Time saved accumulates per session: `elapsed × (1 − base/effective)` summed while
  boosted; shown as `−m:ss` next to the toggle.
- Toggle off → the engine never touches `playbackRate`. Existing speed menu behavior is
  unchanged.

## Producer 1 — transcript gaps (the zero-dependency baseline)

Caption cues already flow through `transcript.ts`, but today the parser keeps only each
line's start time ("One caption line, at the second it starts") — json3 also carries
per-event durations (`dMs`) and per-word offsets (`segs[].tOffsetMs`), currently
discarded. Extend the parser to keep durations; then a gap between one cue's end and the
next cue's start longer than ~0.5 s is a pause.

- Producer trims margins into the window itself: keep ~150 ms of the pause's start at
  speech rate (Overcast-style breathing room), release ~100 ms before speech resumes so
  soft onsets aren't clipped. The apply layer stays dumb.
- No captions → no map → toggle dims with a "no captions" tooltip. Honest, not broken.
- **Known limitation, accepted:** caption gaps can't tell silence from music — an intro
  sting or interlude gets compressed like a pause. The per-player toggle is the escape
  hatch, and the ffmpeg producer fixes it properly (music is loud, so silencedetect
  leaves it alone). No gap-length cap in v1; revisit if real use finds it annoying.

## Producer 2 — ffmpeg silencedetect (desktop, optional, more accurate)

- Discovery mirrors yt-dlp exactly: `CANDIDATE_PATHS`-style probe (`desktop/resolver.ts`
  pattern — Electron inherits no login-shell PATH) plus an optional settings path field.
  Not found → this producer simply doesn't exist; no warning on load.
- On player start: resolve the **audio-only** stream URL (~1 MB/min) and spawn
  `ffmpeg -i <url> -af silencedetect=noise=-30dB:d=0.35 -f null -`. Nothing is written
  to disk; the video keeps streaming to the `<video>` exactly as today.
- silencedetect emits `silence_start` / `silence_end` on stderr **as the download
  progresses**, far faster than realtime — parse lines as they arrive and feed windows
  into the live player mid-playback. Parser is a pure function on stderr text,
  unit-tested against captured output.
- An ffmpeg map **replaces** a transcript map for the same video the moment its first
  window lands. Child killed on player close; one analysis per video per session.
- If a local download of the video exists (issue 002), analyze the local file instead:
  zero bandwidth and near-instant.
- Threshold (−30 dB) and minimum duration (0.35 s) are advanced settings with those
  defaults. Auto-adaptive threshold (Skip Silence has one) is a v2 ticket.

## Persistence and sync — how mobile gets desktop-quality maps

Maps go in a `silence-maps.json` in the plugin data folder, keyed by video ID:
`{ videoId, source: "transcript" | "ffmpeg", computedAt, windows }`. A few hundred bytes
per video. iCloud syncs the vault, so **every video analyzed on the Mac plays with the
ffmpeg-grade map on the phone, no mobile analysis needed** — that is the mobile story
for v1, on top of the transcript producer which already runs there natively.

The 014 lesson applies before it bites: this file is written by two devices, so **save is
a merge, not an overwrite** — re-read, union by video ID, ffmpeg beats transcript, newer
beats older within a source. Entries are immutable once written, so the merge is trivial;
prune LRU past ~200 videos. Merge is pure and unit-tested.

## Settings

- Smart Speed on/off (global default; the player toggle overrides per session).
- Silence speed (default 3×).
- Advanced: transcript gap threshold, ffmpeg path, silencedetect noise/duration.

## Acceptance criteria

1. Fresh vault, **no ffmpeg, no yt-dlp**: captioned video plays with Smart Speed on,
   pauses audibly compress, pitch stays normal, time-saved readout climbs. Works on
   desktop and on the iPhone.
2. Toggle off: `playbackRate` is provably untouched by the engine (existing speed menu
   still works as before).
3. With ffmpeg installed: same video upgrades to a silencedetect map mid-playback; a
   video section with quiet music is *not* compressed by the ffmpeg map.
4. Video with no captions and no ffmpeg: toggle dims with an explanation; nothing errors.
5. Map computed on the Mac appears on the phone after iCloud sync and is used there.
6. Toggling Smart Speed moves no other control (layout-reflow rule).
7. Unit tests: stderr parser, gap→window builder, rate decision function, map merge.

## v2 tickets, not v1

- On-device mobile analysis (`requestUrl` audio fetch + chunked decode / WebCodecs).
- Auto-adaptive silence threshold.
- Voice Boost (needs the localhost-proxy route to un-taint the element).
- Gap-length cap / music heuristics for the transcript producer, if use shows the need.
