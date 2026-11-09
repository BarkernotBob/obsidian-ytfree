# YT Free

Play YouTube videos inside Obsidian notes without ads.

It does not strip ads out of YouTube's player — that is impossible, because YouTube
stitches ads into the same stream as the content. Instead it skips the player entirely and
plays the video's underlying stream in a plain HTML5 `<video>` element. On desktop with
`yt-dlp` installed, yt-dlp finds that stream; otherwise (and always on mobile) YT Free asks
YouTube for it directly. No install is needed. There is no ad in the bytes to begin with.

## Install (Mac)

Paste this into Terminal. It installs Homebrew and `yt-dlp` if you don't have
them, downloads the latest release into your vault, and enables the plugin:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BarkernotBob/obsidian-ytfree/main/setup.sh)"
```

Run it again any time to update. If Obsidian was open while it ran, finish with
Settings → Community plugins → reload → enable **YT Free**.

Optional: `brew install ffmpeg` for downloads above 360p and better Smart Speed.

## Install (from source)

```bash
echo "/path/to/your/vault" > .vault   # once
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
| Open YouTube URL from clipboard | Opens (or makes) the copied video's note, at its timestamp |

Clicking a timestamp seeks the player. Bind the timestamp command to a hotkey — it is the
whole point of taking notes against a video.

### Getting videos in
- **Templater:** `templates/templater-ytfree.md` prompts for a URL and builds the note.
- **Web Clipper:** import `templates/webclipper-ytfree.json`. It fires automatically on
  any `youtube.com/watch` page. The description arrives as a blockquote, with `[[` written as an HTML entity, on
  purpose: the clipper cannot run the plugin's own escaping, and a raw description can open a
  code fence or a heading that breaks the rest of the note (049). Re-import the template after
  updating.

### YouTube links open in Obsidian
Any YouTube video link can open its note in YT Free instead of youtube.com, at the link's
timestamp. An existing note for the video is reused (the hub's, or any note whose `url` /
`media_link` names it); otherwise the note is made the way the hub makes one.

- **In a note:** on by default (Settings → YouTube links → *Open YouTube links here*).
- **The door:** `obsidian://ytfree?url=<YouTube URL, URL-encoded>`. Everything below uses it.
- **Other Mac apps** (Mail, Messages, Slack): install [Finicky](https://github.com/johnste/finicky),
  copy `tools/finicky.js` to `~/.finicky.js`, and set `defaultBrowser` in it to your browser.
  Video links go to Obsidian; everything else goes to the browser as before.
- **Inside the browser:** Settings → YouTube links → *Browser bookmarklet* → Copy. Make a
  bookmark and paste that as its address. Click it on a YouTube video tab.
- **iPhone:** build a Shortcut named *Open in YT Free*:
  1. Shortcuts → + → tap the (i) → turn on **Show in Share Sheet**; accept **URLs** and **Text**.
  2. Add **URL Encode** with *Shortcut Input*.
  3. Add **Text**: `obsidian://ytfree?url=` followed by the *URL Encoded Text* variable.
  4. Add **Open URLs** with that Text.

  Share any YouTube link (from the YouTube app, Messages, Safari) → *Open in YT Free*.
- **Anything else:** copy the link and run *Open YouTube URL from clipboard*.

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

A live canary against YouTube: one yt-dlp resolve and one byte read, about 5 requests.
**Run this when playback breaks**: it tells you whether YouTube changed extraction. The usual
fix is `brew upgrade yt-dlp`. It runs at most once per 24 hours per machine
(`npm run smoke -- --force` overrides), because bursts of live requests got a home network
bot-flagged once. The old full live suite is parked as `npm run smoke:full`.

## Network use and privacy

YT Free talks to these services. Nothing else, and no telemetry: it sends no data about you
or your vault to its author or anyone else.

- **YouTube** (`youtube.com`, `i.ytimg.com`, `*.googlevideo.com`): video pages, streams,
  thumbnails, search, channel pages, transcripts and the RSS feeds of channels you subscribe
  to. The subscriptions hub checks those feeds on a timer while Obsidian is open (hourly by
  default; Settings → *Check every*). Requests are always signed out.
- **The YT Free player page** (`barkernotbob.github.io/obsidian-ytfree/player/`, served by
  GitHub Pages): only when a video plays in YouTube's own embedded player, which then loads
  from YouTube as usual.
- **A notification address you enter** (optional, blank by default): when you fill it in, new
  videos are POSTed there.

**Optional desktop helpers.** If you install [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)
(and optionally `ffmpeg`), YT Free runs them on desktop for HD, downloads and Smart Speed.
They are separate programs you install yourself; YT Free never downloads or installs them.
Without them it plays through its own stream on desktop and mobile.

**Files outside your vault.** On desktop, downloaded videos go to `~/Movies/YT Free` (or the
folder you choose in settings). (Versions before
sign-in was removed kept a cookie file in `~/Library/Application Support/obsidian-ytfree/`;
YT Free deletes it on first load.)

**Accounts and payments.** No account and no sign-in; nothing is paid for. Your YouTube
cookies never reach the plugin.

**Ads.** YT Free shows no ads of its own.

## Known limitations

- Breaks when YouTube changes how its streams are reached. This is a maintenance
  treadmill, not set-and-forget. On desktop the usual fix is `brew upgrade yt-dlp`.
- First resolve after a yt-dlp upgrade is slow (it recompiles its JS challenge solver);
  later ones are much faster.

## License

[MIT](LICENSE)
