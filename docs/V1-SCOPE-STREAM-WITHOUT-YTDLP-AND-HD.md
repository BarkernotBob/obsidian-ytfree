# V1 scope — play without yt-dlp, and HD that actually arrives

**Written:** 2026-10-15, from Isaiah's ask:

> "Why does my work computer not play videos in obsidian, saying I need YT DLP installed. I don't
> get why that is the case when my phone works fine. So I'd like a backup to still work in that
> case."
>
> "It seems that high res videos aren't working oftentimes. I want to get high res video faster,
> more automatically, still without downloading the video."

**Status:** **Built 2026-10-15. Manual test passed 2026-10-15** (Isaiah, work computer, after the language and seeking fixes). Builds issue 043 (desktop full
quality) and the opt-in half of 005 (phone full quality).

## Why it happens (the answer to "why")

- **Desktop only ever resolved through yt-dlp.** The phone has no yt-dlp, so it asks YouTube's own
  app API (InnerTube, the `ANDROID` client) for the 360p single-file stream. That code path was
  mobile-only. On a computer without yt-dlp at a known path the desktop gave up instead of trying
  the path the phone uses.
- **HD depends on something YouTube mostly stopped sending.** The desktop's HD upgrade only swaps
  in an HLS "quality ladder" from yt-dlp. Signed out, that ladder exists on about one video in
  five (measured 2026-08-17, issue 043), and yt-dlp takes ~28s to look for it. Every other video
  stays at 360p. Above 360p YouTube sends picture and sound as two separate files, and the player
  could only play one.

## In scope

1. **Desktop fallback.** If yt-dlp is missing, or yt-dlp fails to resolve, the desktop resolves
   the same way the phone does (InnerTube `ANDROID`, 360p). One Notice per session says so. The
   "yt-dlp is not installed" error only shows if both fail.
2. **HD by stitching the two streams, still streaming.** For the "quality" stage the plugin asks
   InnerTube for the separate picture (H.264 MP4, highest at or below 1080p) and sound (AAC MP4)
   files, reads each file's index (one small byte-range request each), and builds an HLS playlist
   in memory that points at byte ranges of those files. hls.js plays it through Media Source
   Extensions, fetching a few seconds ahead, exactly like any stream. Nothing is written to disk.
   Every byte request goes through Obsidian's `requestUrl`, so there is no CORS problem.
3. **A ladder, not one height** (added 2026-10-15 after Isaiah's first test: "jump ahead and have
   it load the new point quickly, even if that means a quick buffer at lower res"). Every H.264
   height from 240p up to 1080p is offered; hls.js picks by measured bandwidth. A jump into
   unloaded video fetches its first chunk at the lowest rung, so it plays at once, then climbs
   back to HD on its own. The sound is the video's original language, never an automatic dub
   (YouTube lists dubs as separate formats, and one outranked the original on bitrate).
4. **If HD breaks mid-video**, the player drops to 360p at the same spot instead of retrying HD
   (an expired URL hours in still gets a fresh HD resolve).
5. **Order of attempts for HD:** InnerTube `ANDROID` pair, then `IOS` pair, then the `IOS` HLS
   manifest, then (desktop with yt-dlp) the old yt-dlp HLS lookup. First one that serves bytes
   wins; if none do, 360p keeps playing and nothing is shown (043's contract).
6. **Desktop: on by default** under the existing "Upgrade to high quality" setting.
7. **Phone: opt-in**, new setting "HD on this phone (experimental)", off by default. iOS needs
   17.1+ (ManagedMediaSource); without it the phone stays on 360p.

## Out of scope (backlog)

- A manual quality picker (#15). Automatic switching between heights is in.
- VP9/AV1 above 1080p (4K). H.264 tops out at 1080p on YouTube.
- Making InnerTube the *first* path on desktop even when yt-dlp is installed.
- Smart Speed and Download without yt-dlp: both still need yt-dlp (and ffmpeg).

## Risks

- **Not measured live from the build machine** (no YouTube access there). Whether `ANDROID`
  adaptive URLs serve bytes without a PO token is the assumption; the fallback order exists
  because it may not hold. `npm run smoke` has a new case that checks it.
- Segments are fetched whole through `requestUrl` (no streaming body). YouTube's segments are a
  few seconds each, so a segment is roughly 0.5–3 MB at 1080p.

## Manual test (for Isaiah)

1. **Work computer (no yt-dlp).** Install the build, reload Obsidian, open a video note. It plays
   (360p first), and a Notice says it is playing without yt-dlp. Within a few seconds the picture
   sharpens (HD). Pause, seek, change speed: sound and picture stay together.
2. **Mac with yt-dlp.** Open a video with readable on-screen text. It starts as before, then
   sharpens within a few seconds instead of ~30s (or never). Right-click the video → nothing new;
   check *Settings → YT Free → Upgrade to high quality* is on.
3. **Seek far ahead** (click a timestamp near the end). It plays from there within a couple of
   seconds; it does not download the whole video first.
4. **Pause for a minute, resume.** Still in sync.
5. **Phone (optional).** Turn on "HD on this phone (experimental)", open a note, tap play. It
   starts at 360p and sharpens. Lock the phone: note whether audio keeps playing, and tell me.
6. Run `npm run smoke` on the Mac and tell me if the "HD pair serves bytes" case fails.
