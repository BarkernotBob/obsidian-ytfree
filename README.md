# YT Free

Play YouTube videos inside Obsidian notes without ads.

It does not strip ads out of YouTube's player — that is impossible, because YouTube
stitches ads into the same stream as the content. Instead it skips the player entirely:
`yt-dlp` resolves the video to its underlying stream URL, which plays in a plain HTML5
`<video>` element. There is no ad in the bytes to begin with.

**Desktop only. Personal use only** — this is against YouTube's ToS and will never be
submitted to the community plugin store.

## Requirements

```bash
brew install yt-dlp
```

## Install

```bash
./install.sh
```

Then: Obsidian → Settings → Community plugins → reload → enable **YT Free**.

## Use

Put a YouTube URL (or bare video ID) in a `ytfree` code block:

````
```ytfree
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
````

You get native video controls and Picture-in-Picture for free — those are the browser's,
not reimplemented.

### Commands
| Command | What it does |
|---|---|
| Insert timestamp at cursor | Writes a clickable `[12:34]` link at the current playback position |
| Insert player from YouTube URL in clipboard | Turns a copied URL into a `ytfree` block |

Clicking a timestamp seeks the player. Bind the timestamp command to a hotkey — it is the
whole point of taking notes against a video.

### Getting videos in
- **Templater:** `templates/templater-ytfree.md` prompts for a URL and builds the note.
- **Web Clipper:** import `templates/webclipper-ytfree.json`. It fires automatically on
  any `youtube.com/watch` page.

## How the expiry problem is handled

Resolved stream URLs are time-limited **and** locked to your IP, so they die when the
window lapses or you change networks. You never see this:

- Notes store only the **video ID**, never a resolved URL. A note from a year ago works.
- Resolution happens when the block renders, not when you paste.
- URLs are cached in memory only, and treated as expired 10 minutes early.
- If playback errors anyway, the player re-resolves, seeks back to where you were, and
  resumes.

## Quality

Playback starts at 360p within a few seconds, then silently upgrades to 1080p once the
higher-quality stream resolves. The upgrade preserves your position. Turn it off in
settings to stay at 360p.

Why: only the 360p progressive format plays in a bare `<video>` element. Higher
resolutions are HLS, which needs `hls.js` (bundled) and a slower extraction path.

## Tests

```bash
npm test
```

Unit tests — URL parsing, expiry parsing, cache expiry. Fast, no network.

```bash
npm run smoke
```

Live tests against YouTube. **Run this when playback breaks** — it tells you whether
YouTube changed extraction. The usual fix is `brew upgrade yt-dlp`.

## Known limitations

- **Desktop only, permanently.** yt-dlp is a shelled-out binary; Obsidian mobile has no
  Node runtime.
- Breaks when YouTube changes extraction. This is a maintenance treadmill, not
  set-and-forget.
- First resolve after a yt-dlp upgrade is slow (it recompiles its JS challenge solver);
  later ones are much faster.
- No transcripts, screenshots, or offline download — see `docs/V1-SCOPE.md`.
