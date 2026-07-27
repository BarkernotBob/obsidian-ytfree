# 004 — A viewer that works on Obsidian mobile

**Status:** Scoped 2026-07-27. Not built. Awaiting approval.

**Created:** 2026-07-27

## Problem

`manifest.json` declares `isDesktopOnly: true`, so on iPhone and iPad the plugin does not
load at all. Three things follow from that:

- No player. Notes are readable but not watchable.
- Every `[3:05](ytfree:abc123XYZ_:185)` link in the description, transcript, and
  most-replayed list is inert — there is no handler for the `ytfree:` scheme, so tapping
  one does nothing.
- The flag is not arbitrary. Playback, download, and transcript fetch all shell out to a
  yt-dlp binary via `child_process`, and there is no yt-dlp and no Node on iOS.

Watch Later notes are read on the phone more than anywhere else. A note you can read but
not watch, whose timestamps do nothing, is the wrong half of the feature.

## Decision: mobile plays through YouTube's own embed, with ads

Desktop keeps the yt-dlp player exactly as it is today — ad-free, that is the entire point
of the plugin and nothing here touches it.

Mobile gets a YouTube IFrame embed and **shows YouTube's ads**. This is a deliberate
trade, made explicitly, and it is not a bug to be fixed later:

- The alternative that keeps mobile ad-free is reimplementing yt-dlp's YouTube extractor
  in TypeScript — InnerTube calls, signature descrambling, PO-token attestation. That
  means eval'ing YouTube's `base.js` inside the vault and re-fixing it every time YouTube
  ships a change. Rejected on maintenance cost and on security.
- The other ad-free option is downloading each video into the vault and playing the local
  file. Rejected: unacceptable vault and iCloud bloat for the volume of videos involved.

So: ad-free where it is cheap (desktop), watchable where it is not (mobile).

## Solution

### 1. Make the plugin loadable on mobile at all

This is most of the work, and all of the risk. Today every Node import is top-level:

- `src/main.ts` — `fs`, `fs/promises`, `os`, `path`
- `src/resolver.ts` — `child_process`, `util`
- `src/transcript.ts` — `child_process`, `util`
- `src/download.ts` — `child_process`, `fs`, `fs/promises`, `path`, `util`

They are `external` in esbuild, so the first `require("child_process")` at module load
throws on mobile and the plugin dies before `onload` runs. Guarding at the call site is
not enough — the import itself is what fails.

Plan:

- Move the yt-dlp and filesystem code into `src/desktop/` (`resolver`, `download`,
  `transcript-fetch`), reached only through `await import("./desktop/...")` inside a
  `Platform.isDesktopApp` branch. Nothing under `src/desktop/` may be imported at the top
  of a file that mobile loads.
- Split `src/transcript.ts`: the pure parsing and rendering (`parseJson3`, `groupCues`,
  `topPeaks`, `renderTranscript`, `upsertSection`, …) stays platform-neutral and keeps its
  26 tests; only `fetchVideoInfo` moves to `src/desktop/`.
- Remove `isDesktopOnly` from the manifest.
- Register the desktop-only commands (download, fetch transcript) only when
  `Platform.isDesktopApp`, so mobile's command palette does not offer things that cannot
  run.

Already platform-neutral and needing no change: `linkifyRendered`, `collapseProperties`,
`src/description.ts`, `src/format.ts`, and the `ytfree:` click handler.

### 2. The mobile player — docked, not floating

Desktop pins a floating player. **Do not reuse that on a phone.** A draggable hovering
panel on a 390pt screen covers the note it is supposed to accompany. Mobile gets its own
layout, not a scaled-down desktop one:

- The player docks to the **top of the note view**, full width, 16:9, and the note content
  scrolls underneath it.
- Its height is reserved from mount, before the iframe loads, so nothing below it moves
  when it appears or when its state changes. Same no-reflow rule as the desktop control
  row.
- One player at a time, same as desktop.
- A close control that unmounts it and releases the reserved space in one step.

### 3. Playback and seeking

Embed URL:

```
https://www.youtube-nocookie.com/embed/<videoId>?enablejsapi=1&playsinline=1&rel=0&start=<secs>
```

- `youtube-nocookie.com` for the same reason the rest of this plugin avoids YouTube
  cookies: no tracking profile built from what is in the vault.
- `playsinline=1` is mandatory on iOS. Without it the video hijacks the whole screen on
  play, which makes reading the transcript alongside it impossible.
- `enablejsapi=1` gives seeking without loading YouTube's IFrame API library — commands
  can be posted to the frame directly.

Seek, on tapping any `ytfree:<id>:<secs>` link:

- **Player already mounted for this video** → `postMessage` a
  `{"event":"command","func":"seekTo","args":[secs,true]}` payload at
  `https://www.youtube-nocookie.com`, after the `{"event":"listening"}` handshake has
  confirmed the frame is ready. Queue the seek if it is not.
- **Not mounted** → mount it with `start=<secs>`, which lands on the right moment with no
  handshake needed.
- **A different video's player is open** → replace it, same as desktop.

### 4. What mobile cannot do, and says so

Transcript fetch, most-replayed fetch, and download all need yt-dlp. On mobile the
commands are not registered; if a note has no `## Transcript`, the note is simply missing
it. Do **not** fail silently and do not half-fetch. Fetching on desktop and syncing the
note stays the workflow.

## Acceptance criteria

- Plugin loads on Obsidian iOS with no console error; `isDesktopOnly` is gone.
- Desktop behaviour is byte-for-byte unchanged: ad-free yt-dlp playback, pinned floating
  player, download, transcript fetch, all still passing their existing tests.
- On mobile, opening a Watch Later note and tapping play shows the video docked at the top
  of the note, playing inline, not fullscreen.
- On mobile, tapping a timestamp in the description, the transcript, or the most-replayed
  list seeks the docked player to that second — mounting it first if it is not open.
- Tapping a timestamp never moves any text on screen.
- Desktop-only commands do not appear in mobile's command palette.
- Unit tests still pass, with the platform-neutral transcript tests unmoved.

## Risks to settle before or during the build

1. **Does Obsidian mobile's webview permit a plugin-created iframe to youtube-nocookie.com?**
   Notes embed YouTube iframes routinely, so this is very likely fine, but it has not been
   verified for a plugin-injected frame and it is the assumption the whole issue rests on.
   Verify this first — a 10-line spike, before anything else is built.
2. **`origin` parameter.** The YouTube JS API normally wants `origin` set to the host page.
   Obsidian mobile's webview origin is not a normal `https://` origin, and passing a wrong
   value can break the API outright. Plan is to omit it and target the frame's origin when
   posting; confirm seeking actually works that way on a real device.
3. **iOS autoplay.** iOS blocks programmatic autoplay without a user gesture. A tap on a
   timestamp *is* a gesture, so this should hold, but the mount-with-`start` path needs
   checking on device.

## Not in scope (v2 tickets if wanted)

- Ad-free playback on mobile.
- Fetching transcripts or downloading on mobile.
- Playing a downloaded local file on mobile.
- Long-press a timestamp to open the YouTube app at that moment.

## Manual test (for BarkernotBob)

_Written when the issue is completed, per the repo convention — the steps depend on what
the build actually ends up doing._
