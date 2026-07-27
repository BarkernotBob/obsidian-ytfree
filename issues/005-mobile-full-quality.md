# 005 — Full quality on mobile (above 360p)

**Status:** Scoped 2026-07-27. **Not built. Blocked on [004](004-mobile-viewer.md).**
**Created:** 2026-07-27

## Problem

[Issue 004](004-mobile-viewer.md) gets video playing on Obsidian mobile at **360p**, because
itag 18 is the only muxed (video-and-audio-in-one-file) format YouTube still offers, and a
bare `<video>` element can only play a single file.

360p is 640×360. A docked player on an iPhone is about 390×220 CSS px — so it is soft but
watchable, because the CSS box is smaller than the source. On an iPad the box is two to three
times wider than the source and it looks bad. On any device the text in a screen-recording,
a code sample, or a whiteboard is unreadable, and those are exactly the videos that end up in
Watch Later.

Everything above 360p exists — up to 2160p, measured — but as **separate video and audio
streams**.

## What the measurements already establish

From the 2026-07-27 probe recorded in issue 004, re-runnable via
[`spikes/innertube/probe.mjs`](../spikes/innertube/probe.mjs):

| Fact | Consequence for this issue |
|---|---|
| `adaptiveFormats[]` carries a plain, unciphered `url` per format, up to 2160p | The streams are reachable. No descrambling needed here either. |
| Each format carries `initRange`, `indexRange`, `contentLength`, `mimeType` with codecs | Enough to synthesize a manifest without probing the files. |
| `hlsManifestUrl` present on 1 of 10 videos; `dashManifestUrl` never | **YouTube will not hand us a manifest. We build it.** |
| googlevideo answers `Range:` headers and `&range=start-end` query params | Byte-range segmenting works two different ways. |
| googlevideo sends **no** `Access-Control-Allow-Origin` | Plain `fetch()` from `capacitor://localhost` is blocked. A custom loader is mandatory, not optional. |

That last row is the one that decides the shape of this issue.

## The iOS constraint that sets the floor

Separate streams have to be muxed in the page, which means Media Source Extensions.

- **iPhone WKWebView has no plain `MediaSource`.** It has `ManagedMediaSource`, from iOS 17.1.
- iPad has had `MediaSource` for longer.
- Android WebView has `MediaSource` normally.

So this feature has an **iOS 17.1 floor**, and must feature-detect
(`"ManagedMediaSource" in window || "MediaSource" in window`) and fall back to the 360p path
from 004 rather than showing a broken player. The fallback is not a nicety — it is the
behaviour on any device that misses the floor.

## Three routes, and the recommendation

### A. Synthesized DASH manifest + shaka-player — **recommended**

Build an MPD in memory from `adaptiveFormats`, one `<Representation>` per format, each with
`<SegmentBase indexRange="…"><Initialization range="…"/></SegmentBase>`. Those two ranges are
already in the InnerTube response, so the manifest needs no network probing to construct.
Point shaka at a blob URL of the MPD and register a request filter that routes every segment
fetch through Obsidian's `requestUrl`.

- **Least code we own.** `SegmentBase` means the player fetches the `sidx` box itself and
  works out segment boundaries. We never parse an MP4 box.
- shaka supports `ManagedMediaSource` and has a documented networking-plugin seam, which is
  what makes the CORS workaround clean rather than a monkey-patch.
- ABR, quality selection, and buffer management come with it.
- **Cost:** a second media library in the bundle (~400KB minified) alongside hls.js, and an
  MPD generator to keep correct.

### B. Synthesized HLS playlist + hls.js

hls.js is **already a dependency** and already supports `ManagedMediaSource`, so the bundle
does not grow and the desktop player keeps using the same library.

- **But** an HLS playlist of fMP4 byte ranges needs explicit `#EXT-X-BYTERANGE` per segment
  plus an `#EXT-X-MAP` init segment — which means fetching the `indexRange` bytes and
  **parsing the `sidx` box ourselves** to find where each segment starts and ends. That is
  the code route A avoids.
- Choose this only if bundle size turns out to matter more than the sidx parser.

### C. Paired `<video>` + `<audio>`, no MSE at all

Load the video-only stream in a muted `<video>` and the audio-only stream in an `<audio>`,
both as direct URLs, and keep them in step by hand.

- **Cheapest by a wide margin**, no library, no CORS problem (media elements are not subject
  to CORS), no iOS-version floor.
- **Drift is the whole risk**, and it is not theoretical: two independent decode pipelines,
  resynced on play/pause/seek and by watching `timeupdate`, will still slide under load. Lip
  sync is the one artifact a viewer notices instantly.
- Worth a timeboxed spike before committing to A, because if drift holds under a few minutes
  of real playback, it deletes this entire issue.

**Recommendation: spike C for one sitting, and if it drifts, build A.**

## Solution (assuming route A)

1. **`src/mobile/formats.ts`** — pick a rendition pair from `adaptiveFormats`. Prefer
   `avc1` video and `mp4a` audio over `vp9`/`av01`/`opus`: iOS decodes H.264 in hardware and
   AV1 in software, so the "better" codec costs battery and can drop frames. Cap the default
   at 1080p; 4K on a phone is bandwidth spent on nothing.
2. **`src/mobile/mpd.ts`** — pure function, `adaptiveFormats[] → MPD string`. No I/O, so it
   is unit-testable against recorded fixtures, which is the point of splitting it out.
3. **`src/mobile/net.ts`** — a shaka request filter that swaps `fetch` for `requestUrl` and
   translates the `Range` header. This is the piece that will be fiddly; keep it small.
4. **Quality picker** in the docked player, plus a remembered default in settings, plus
   **Auto** (shaka's ABR).
5. **Graceful degradation** in one place: no MSE, or manifest build fails, or shaka errors →
   fall back to the 360p muxed URL from 004, with a notice saying quality was reduced and
   why. Never a black player.

## Acceptance criteria

- On an iPhone running iOS 17.1+, a Watch Later note plays at 1080p, ad-free, docked, inline.
- Audio and video stay in sync across a full video, and across pause, seek, backgrounding,
  and a network change.
- A quality picker offers Auto plus the available heights; the chosen default persists.
- On a device without MSE, playback still works at 360p and says so once.
- Seeking by tapping a timestamp still lands within a second of the target.
- Desktop behaviour is unchanged.
- `mpd.ts` and `formats.ts` have unit tests against recorded `adaptiveFormats` fixtures,
  including a video with av01-only high renditions and one with no 1080p at all.

## Risks

1. **Bandwidth.** 1080p is roughly 5–10× the data of 360p. A wifi-only or "cellular caps at
   480p" setting stops being optional at this point; scope it here rather than discovering it
   on a phone bill.
2. **Battery and memory.** Every segment now passes through JS and a `SourceBuffer` instead of
   going straight to the native media stack. Watch memory on a two-hour video.
3. **`requestUrl` and large binary bodies.** It returns an `ArrayBuffer`, which is right, but
   it has no streaming interface — each segment is fully buffered before it is appended. Check
   what segment size that implies before assuming it is fine.
4. **`ManagedMediaSource` requires `<video disableRemotePlayback>`** in some WebKit versions,
   and it can suspend the source when the element is not visible — which is what makes
   background audio work differently from the 360p path. Confirm background playback survives.
5. **Two media paths to maintain.** 004's muxed path cannot be deleted; it is the fallback.

## Not in scope

- Ad-free anything on desktop — unchanged, still yt-dlp.
- Downloading at full quality on mobile.
- Subtitles rendered from the HLS/DASH manifest. The `## Transcript` section already covers
  the need, and better.

## Manual test (for BarkernotBob)

_Written when the issue is completed, per the repo convention._
