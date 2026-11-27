# Desktop helpers (removed in 0.2.2)

**YouTube for You 0.2.2 and later does not run yt-dlp or ffmpeg.** The Obsidian community
directory's automated review rates any plugin that runs other programs (Shell Execution) or
touches files outside the vault (Direct Filesystem Access) with a Caution label. To list
without it, these went:

- Offline downloads (*Download this video for offline*, *Delete the local copy*), and playing a
  downloaded copy.
- yt-dlp as the first playback tier. Desktop now plays our own stream, with YouTube's embedded
  player as the fallback, the same as the phone.
- ffmpeg Smart Speed. Smart Speed still works from caption timing on every device.
- The Dock audio badge (macOS) and the Shorts redirect probe.

A separate desktop-only companion plugin may bring these back later (Isaiah, 2026-11-26).

The rest of this page describes the helpers as they were in 0.2.1, for anyone on that version.

# Optional desktop helpers: yt-dlp and ffmpeg

YouTube for You needs neither. Without them it plays every video through its own stream, with YouTube's
embedded player as the fallback, on desktop and mobile.

If they are on your computer, the desktop app uses them:

| Helper | What it adds |
|---|---|
| [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) | Offline downloads (*Download this video for offline*). It is also tried first for playback, before our own stream. |
| `ffmpeg` | Downloads above 360p, and Smart Speed that measures silence from the audio instead of from caption timing. |

YouTube for You never downloads, installs or updates either program.

## Installing them

- **macOS:** `brew install yt-dlp ffmpeg` ([Homebrew](https://brew.sh)).
- **Windows:** `winget install yt-dlp.yt-dlp Gyan.FFmpeg`.
- **Linux:** your package manager, or `pipx install yt-dlp`.

YouTube for You looks in the usual install folders and on Obsidian's PATH. If it does not find them, put
the full path in **Settings → YouTube for You → Desktop helpers (optional)**. Windows and Linux are not
tested yet.

## One-line Mac setup (plugin + yt-dlp)

For a Mac without Homebrew. Installs Homebrew and yt-dlp, downloads the latest YouTube for You release
into your vault and enables it:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BarkernotBob/obsidian-ytfree/main/setup.sh)"
```

Optional afterwards: `brew install ffmpeg`.

## Where downloads go

A `YT Free` folder in Movies (Videos on Windows and Linux), outside the vault so a 700 MB video
does not sync to every device. Change it in the same settings section.
