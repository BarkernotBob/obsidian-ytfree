# 004 — A viewer that works on Obsidian mobile

**Status:** Re-scoped 2026-07-27 after the iframe spike failed. **Not built.**
**Created:** 2026-07-27
**Follow-on:** [005 — full quality on mobile](005-mobile-full-quality.md). This issue deliberately
ships 360p.

## The short version

The iframe is dead, and it is not coming back. Replace it with the thing desktop already
does: resolve a stream URL, hand it to a `<video>` element. The only piece mobile lacks is
a resolver that isn't yt-dlp — and YouTube's own InnerTube endpoint is that resolver, in
about eighty lines, with no signature descrambling.

Mobile ends up **ad-free**, which the previous version of this issue had given up on.

## Problem

`manifest.json` declares `isDesktopOnly: true`, so on iPhone and iPad the plugin does not
load at all. Three things follow:

- No player. Notes are readable but not watchable.
- Every `[3:05](ytfree:abc123XYZ_:185)` link in the description, transcript, and
  most-replayed list is inert — there is no handler for the `ytfree:` scheme.
- The flag is not arbitrary. Playback, download, and transcript fetch all shell out to a
  yt-dlp binary via `child_process`, and there is no yt-dlp and no Node on iOS.

Watch Later notes are read on the phone more than anywhere else. A note you can read but
not watch, whose timestamps do nothing, is the wrong half of the feature.

## Why the previous plan (a YouTube embed) is abandoned

Two runs of [`spikes/mobile-iframe`](../spikes/mobile-iframe/README.md) on an iPhone,
iOS 18.7:

| | Result |
|---|---|
| `ytfree:` link interception | **PASS** |
| `postMessage` channel to the frame | **PASS**, 1.3–2.7s on youtube.com |
| Video actually plays | **FAIL — Error 153, every variant** |

Error 153 on all eight combinations: both hosts, and all four parameter variants (no JS API
at all; API with no `origin`; API with `origin=capacitor://localhost`; API with
`origin=https://www.youtube.com`). The first hypothesis — that `enablejsapi=1` is what
demands a valid origin — was wrong; the `plain` variant fails identically.

**The one open confound is now closed.** Every spike run used `h0EGCnBjTVk`, and error 153 is
also what YouTube returns when an owner disables embedding. Checked 2026-07-27:

```
GET https://www.youtube.com/oembed?url=…v%3Dh0EGCnBjTVk&format=json  →  HTTP 200
```

oEmbed answers `401` for an embed-disabled video. It answered `200`. **Embedding is enabled
and the embed still refuses to play**, so the cause is the origin: Obsidian iOS runs at
`capacitor://localhost`, which is not an http(s) origin, so the framed player sends no
usable `Referer` and declines to configure itself. Nothing the plugin passes can change
that — it is a property of the webview.

That left exactly one route to an in-app embed: a hosted https shim (GitHub Pages) that
frames the player and relays seeks. Rejected on all three of the axes that matter —
it needs a page to stay published forever, it is a second moving part on a second origin,
and it cannot be shared without every user deploying their own copy or trusting ours.

## Decision: resolve in the plugin, play in a `<video>` element

No iframe. No hosted shim. No origin to satisfy, because nothing is framed.

`POST https://www.youtube.com/youtubei/v1/player` with a mobile client context returns
stream URLs that are **not ciphered** — a plain `url` field per format, playable as-is.
Measured against live YouTube on 2026-07-27:

| Check | Result |
|---|---|
| `IOS` / `ANDROID` client → `playabilityStatus` | `OK` on all 10 videos tested |
| Formats requiring `base.js` signature descrambling | **0 of 27** — every format ships a plain `url` |
| URLs serve bytes with no PO token | `HTTP 206`, `video/mp4`, correct `Content-Range` |
| `ANDROID` client muxed itag 18 (360p, video **and** audio in one file) | present on **every** video tested |
| Adaptive (separate video/audio) formats | up to 2160p |
| `IOS` client `hlsManifestUrl` | **1 of 10** — HLS is effectively gone. Do not build on it. |
| `dashManifestUrl`, any client version 17.x–20.x | never present |
| No API key in the request | works |

Re-run the measurement any time with [`spikes/innertube/probe.mjs`](../spikes/innertube/probe.mjs).
**Do this first in the next session** — the whole issue rests on it, and it takes five seconds.

### Why this is the right trade, stated plainly

This is reimplementing a slice of yt-dlp, which the previous version of this issue rejected.
That rejection assumed the expensive slice: InnerTube plus signature descrambling plus
PO-token attestation, meaning `base.js` eval'd inside the vault and re-fixed on every
YouTube change. The measurements say the slice actually needed is one JSON POST and a field
read. No `eval`, no crypto, no attestation.

What we accept in exchange:

- **YouTube can break it.** When it does, the symptom is a resolve failure, not a wedged
  player, and the fallback below is one tap.
- **Age-restricted and members-only videos will not resolve** (`LOGIN_REQUIRED`). They do
  not resolve on desktop without cookies either. Say so and offer the fallback.
- **360p until [005](005-mobile-full-quality.md).** See "The cost" below.

### The cost: 360p in v1

itag 18 (640×360, H.264 + AAC, muxed) is the only format that is a single file, and
therefore the only one a bare `<video>` can play. YouTube's old 720p progressive format
(itag 22) is effectively gone — already measured independently for issue 002.

Everything above 360p arrives as separate video and audio streams, which needs Media Source
Extensions, a synthesized manifest, and a custom loader to get around CORS. That is real
work with a real iOS-version floor, so it is [issue 005](005-mobile-full-quality.md) and not
this one.

On a 390pt iPhone the docked player is about 390×220 CSS px, so 360p is soft but honest.
On an iPad it will look bad. **Ship 360p, then fix quality** — the risky part of this issue
is not the resolver, it is making the plugin load on iOS at all, and that should not wait
behind a media-engine project.

## Solution

### 1. Make the plugin loadable on mobile at all

This is most of the work and all of the risk. Today every Node import is top-level:

| File | Node imports |
|---|---|
| `src/main.ts` | `fs`, `fs/promises`, `os`, `path` |
| `src/resolver.ts` | `child_process`, `util` |
| `src/transcript.ts` | `child_process`, `util` |
| `src/download.ts` | `child_process`, `fs`, `fs/promises`, `path`, `util` |

They are `external` in esbuild, so the first `require("child_process")` at module load throws
on mobile and the plugin dies before `onload` runs. **Guarding at the call site is not
enough — the import itself is what fails.**

- Move the yt-dlp and filesystem code to `src/desktop/` (`resolver`, `download`,
  `transcript-fetch`), reached only through `await import("./desktop/…")` inside a
  `Platform.isDesktopApp` branch. Nothing under `src/desktop/` may be imported at the top of
  a file mobile loads.
- **New `src/stream.ts`** holding `ResolveMode`, `ResolvedStream`, `StreamProvider`,
  `extractVideoId`, `extractVideoIds`, and `parseExpiry` — all already platform-neutral, all
  currently trapped in `resolver.ts` behind its `child_process` import. `src/player.ts`
  imports `ResolveMode` and `ResolvedStream` as values, not `import type`, so it currently
  drags `resolver.ts` into the mobile bundle. Fix that here, not later.
- Split `src/transcript.ts`: parsing and rendering (`parseJson3`, `groupCues`, `topPeaks`,
  `renderTranscript`, `upsertSection`) stays neutral and keeps its 26 tests; only
  `fetchVideoInfo` moves to `src/desktop/`.
- Remove `isDesktopOnly` from the manifest and rewrite its description — it currently ends
  "Desktop only."
- Register download and transcript-fetch commands only when `Platform.isDesktopApp`, so
  mobile's palette does not offer things that cannot run.

Already neutral and needing no change: `linkifyRendered`, `collapseProperties`,
`src/description.ts`, `src/format.ts`, `src/capture.ts`, and the `ytfree:` click handler.

### 2. The mobile resolver — `src/mobile/innertube.ts`

One function with the same `StreamProvider` shape `YtFreePlayer` already takes, so the
player does not learn it is on a phone.

- `requestUrl()` from `obsidian` for the POST. It is CORS-free, available on mobile, and
  takes custom headers. Plain `fetch()` will not do: the webview origin is
  `capacitor://localhost` and youtube.com sends no `Access-Control-Allow-Origin`.
- Body: `{videoId, context:{client:{clientName:"ANDROID", clientVersion:"20.10.38",
  androidSdkVersion:34, hl:"en", gl:"US"}}, contentCheckOk:true, racyCheckOk:true}` with the
  matching `com.google.android.youtube/…` User-Agent. No `?key=` parameter.
- Take `streamingData.formats[]` where `itag === 18`. If it is absent, try the `IOS` client
  and take `hlsManifestUrl` if present (rare, but free 1080p and iOS plays HLS natively).
  If neither, fail to the fallback.
- Return `{url, isHls, mode:"fast", expiresAt}` using the existing `parseExpiry`.

**Resolution must happen on the device that plays.** Googlevideo URLs are IP-locked; a URL
resolved on the Mac and synced in frontmatter will 403 on cellular. Never cache a resolved
URL into a note.

### 3. The mobile player — docked, not floating

Reuse `YtFreePlayer`. It already wraps a `<video>`, already re-resolves and seeks back when
a URL expires or the network changes, and that expiry logic is exactly what mobile needs.
Feed it the mobile provider and change the layout, not the class.

- **Do not reuse the floating pinned panel.** A draggable hovering player on a 390pt screen
  covers the note it accompanies. Mobile docks to the **top of the note view**, full width,
  16:9, note content scrolling underneath.
- Height reserved from mount, before the media loads, so nothing below moves when it appears
  or changes state. Same no-reflow rule as the desktop control row.
- The desktop control row exists to surface what Chromium hides in its overflow menu. iOS
  Safari's native controls already expose PiP, AirPlay, and speed. **Drop the custom row on
  mobile** and keep only the timestamp-stamp button.
- One player at a time, same as desktop. A close control that unmounts and releases the
  reserved space in one step.

### 4. Seeking

`video.currentTime = secs`. That is the whole implementation.

Worth noticing what this deletes: the old plan needed an `{"event":"listening"}` handshake, a
`postMessage` payload aimed at the right origin, and a queue for seeks arriving before the
frame was ready. None of it exists any more.

- Player mounted for this video → set `currentTime`.
- Not mounted → mount, then set `currentTime` on `loadedmetadata`.
- A different video's player open → replace it, same as desktop.

### 5. What we get for free from a real `<video>`

Picture-in-picture, AirPlay, background audio, lock-screen and Control Center transport,
system volume, and playback speed — all native, none of which an embed would have given.

### 6. Fallback, and it must be visible

When resolve fails (YouTube change, age gate, no network), show one control that opens
`https://youtu.be/<id>?t=<secs>` in the YouTube app, carrying the timestamp that was tapped.
Do not fail silently and do not retry in a loop.

### 7. What mobile still cannot do

Transcript fetch, most-replayed fetch, and download all need yt-dlp. Their commands are not
registered on mobile. A note without `## Transcript` is simply missing it. Fetching on
desktop and syncing the note stays the workflow.

## Acceptance criteria

- Plugin loads on Obsidian iOS with no console error; `isDesktopOnly` is gone from the
  manifest and its description no longer says "Desktop only".
- Desktop behaviour is unchanged: ad-free yt-dlp playback, pinned floating player, download,
  transcript fetch, all still passing their existing tests.
- On mobile, opening a Watch Later note and tapping play shows the video docked at the top of
  the note, playing inline, not fullscreen, **with no ads**.
- On mobile, tapping a timestamp in the description, transcript, or most-replayed list seeks
  the docked player to that second — mounting it first if it is not open.
- Tapping a timestamp never moves any text on screen.
- A video that fails to resolve shows the "Open in YouTube" fallback, at the right timestamp.
- Desktop-only commands do not appear in mobile's command palette.
- Unit tests still pass, with the platform-neutral transcript tests unmoved.
- New unit tests cover the InnerTube response parser against **recorded fixtures**, not the
  network: itag 18 present, itag 18 absent + HLS present, neither present, `LOGIN_REQUIRED`.

## Risks to settle during the build

1. **`requestUrl` custom headers on iOS.** The User-Agent has to reach YouTube for the
   ANDROID client to be believed. Documented and expected to work; confirm on device before
   building anything on top of it. If Obsidian pins its own UA, check whether the client
   context alone is sufficient.
2. **Does WKWebView load a googlevideo URL into `<video>` directly?** It should — a media
   element without `crossorigin` is not subject to CORS, and googlevideo sends
   `Accept-Ranges: bytes` and answers range requests. Verify early; it is the second
   load-bearing assumption after the resolver.
3. **Cellular data.** 360p is roughly 0.5–1 MB/min, which is fine, but there is currently no
   wifi-only guard anywhere in the plugin. Note it; do not build it here.
4. **Rate limiting.** `TVHTML5` already answers "Sign in to confirm you're not a bot" for
   these calls. `ANDROID` and `IOS` did not on 2026-07-27, but they can start. The fallback is
   the mitigation; make the notice say which failure it was.

## Not in scope

- Quality above 360p — [issue 005](005-mobile-full-quality.md).
- Fetching transcripts or downloading on mobile.
- Playing a downloaded local file on mobile.
- Wifi-only or data-saver settings.
- Replacing the desktop yt-dlp resolver with InnerTube. Tempting, and probably right later,
  but it would put the one working player at risk to save nothing today.

## Manual test (for BarkernotBob)

_Written when the issue is completed, per the repo convention._
