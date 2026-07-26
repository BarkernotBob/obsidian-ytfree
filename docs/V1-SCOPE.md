# v1 scope — obsidian-ytfree

Gate required before build. Written 2026-07-26.

**One sentence:** paste a YouTube link into a note and get an ad-free, always-playable
video with controls, PiP, and one-key timestamp capture.

**Smallest version a stranger gets value from:** a ` ```ytfree ` code block containing a
YouTube URL renders an ad-free video player inline, with a hotkey that writes
`[12:34](...)` into the note at the cursor.

## Verified foundations (tested 2026-07-26, before any code)

| Fact | Evidence |
|---|---|
| yt-dlp resolves YT → direct stream | `yt-dlp -g` returned googlevideo URL |
| Stream is really fetchable, no player | `HTTP 206`, `content-type: video/mp4` |
| Only progressive muxed format is 360p | itag 18; all higher tiers are HLS/DASH |
| URLs are IP-locked and time-limited | URL carries `ip=` and `expire=` params |
| Web Clipper can auto-fire on YT | templates support regex URL triggers |
| Media Extended has no ad-free path | its docs list no yt-dlp/Invidious support |

## In scope for v1

### 1. Rendering
- Markdown code block ` ```ytfree ` whose body is a YouTube URL or bare video ID.
- Renders a native `<video controls>` element.
  - Transport controls: **free** (browser native).
  - Picture-in-Picture: **free** (browser native, Electron supports it).
- Quality: HLS via bundled `hls.js` (up to 1080p). Falls back to itag 18 (360p) if HLS
  fails.

### 2. The expiry problem — solved automatically, never surfaced to the user
This is the core engineering requirement, not a nice-to-have.

- **The note stores only the video ID.** A resolved URL is never written to disk. This
  alone means a note opened a year later still works.
- Resolve happens at *render time*, not at paste time.
- Resolved URLs are cached in memory only, keyed by video ID, with the expiry read from
  the URL's `expire=` param and treated as expired 10 minutes early.
- **Mid-playback recovery:** on a `<video>` `error` event, capture `currentTime`,
  re-resolve, reload, seek back, resume playback. The user sees at most a brief stall.
- The same recovery path covers the IP-change case (laptop moves networks → 403), which
  is more likely in practice than a 6-hour video.

### 3. Timestamp capture
- Command + hotkey: insert `[MM:SS]` at cursor, linking back to that moment.
- Clicking an existing timestamp seeks the player to it.

### 4. The two entry paths the user asked for
- **Templater/template:** a snippet that takes a pasted URL and emits the code block.
- **Obsidian Web Clipper:** a JSON template with a regex trigger on
  `youtube\.com/watch` that emits the same code block plus title/channel/date
  properties. Ships in the repo as an importable file.

### 5. Failure behaviour
- yt-dlp missing → render an inline message with the `brew install yt-dlp` command.
- Extraction fails → show yt-dlp's actual stderr, plus "try `brew upgrade yt-dlp`".
  Never fail silently; extraction breakage is expected over time.

## Explicitly NOT v1 (→ v2 tickets)

- Transcripts / subtitle search
- Screenshot capture into the note
- Local download / offline archival (needs ffmpeg for merging)
- Playlist or channel support
- Any mobile support — **impossible**, not deferred: yt-dlp is a shelled-out binary and
  Obsidian mobile has no Node runtime. The global mobile-first rule cannot apply to
  this project.
- Playback speed memory, loop/A-B repeat, autoplay-next

## Known hard limitations (accept, do not attempt to fix in v1)

- Desktop-only, permanently.
- Against YouTube's ToS → private repo, never submitted to the community store.
- Breaks when YouTube changes extraction; recovery is `brew upgrade yt-dlp`.
- First play has a resolution delay (~1–2s) while yt-dlp runs.

## Acceptance criteria

1. A ` ```ytfree ` block with a YouTube URL renders a playing video with no ads.
2. Native controls work; PiP button enters Picture-in-Picture.
3. Hotkey inserts a correctly-formatted timestamp at the cursor.
4. Clicking a timestamp seeks the player.
5. A note whose cached URL has expired plays without any user action.
6. Killing the network mid-playback and restoring it resumes from the same position.
7. With yt-dlp uninstalled, the block shows an actionable install message.
8. Web Clipper template imports and fires on a `youtube.com/watch` page.

## Manual test (for BarkernotBob)
To be written when v1 is complete, per the backlog rule.
