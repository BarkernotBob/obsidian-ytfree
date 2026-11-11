# Optional desktop helpers: yt-dlp and ffmpeg

YT Free needs neither. Without them it plays every video through its own stream, with YouTube's
embedded player as the fallback, on desktop and mobile.

If they are on your computer, the desktop app uses them:

| Helper | What it adds |
|---|---|
| [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) | Offline downloads (*Download this video for offline*). It is also tried first for playback, before our own stream. |
| `ffmpeg` | Downloads above 360p, and Smart Speed that measures silence from the audio instead of from caption timing. |

YT Free never downloads, installs or updates either program.

## Installing them

- **macOS:** `brew install yt-dlp ffmpeg` ([Homebrew](https://brew.sh)).
- **Windows:** `winget install yt-dlp.yt-dlp Gyan.FFmpeg`.
- **Linux:** your package manager, or `pipx install yt-dlp`.

YT Free looks in the usual install folders and on Obsidian's PATH. If it does not find them, put
the full path in **Settings → YT Free → Desktop helpers (optional)**. Windows and Linux are not
tested yet.

## One-line Mac setup (plugin + yt-dlp)

For a Mac without Homebrew. Installs Homebrew and yt-dlp, downloads the latest YT Free release
into your vault and enables it:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BarkernotBob/obsidian-ytfree/main/setup.sh)"
```

Optional afterwards: `brew install ffmpeg`.

## Where downloads go

A `YT Free` folder in Movies (Videos on Windows and Linux), outside the vault so a 700 MB video
does not sync to every device. Change it in the same settings section.
