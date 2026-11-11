# YouTube for You

Watch YouTube videos inside your Obsidian notes, in a plain video player, and take notes
against them with clickable timestamps. Works on desktop and mobile. Nothing else to install.

YouTube for You does not strip ads out of YouTube's player. It skips that player: it asks YouTube for
the video's stream and plays it in a normal `<video>` element. When a video's stream can't be
reached, it falls back to YouTube's own embedded player in the same place.

## Install

In Obsidian: **Settings → Community plugins → Browse**, search for **YouTube for You**, then
**Install** and **Enable**.

Until the plugin is listed there, install by hand: download `main.js`, `manifest.json` and
`styles.css` from the [latest release](https://github.com/BarkernotBob/obsidian-ytfree/releases/latest)
into `<your vault>/.obsidian/plugins/ytfree/`, then enable **YouTube for You** under Community plugins.

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
Any YouTube video link can open its note in YouTube for You instead of youtube.com, at the link's
timestamp. An existing note for the video is reused (the hub's, or any note whose `url` /
`media_link` names it); otherwise the note is made the way the hub makes one.

- **In a note:** on by default (Settings → YouTube links → *Open YouTube links here*).
- **The door:** `obsidian://ytfree?url=<YouTube URL, URL-encoded>`. Everything below uses it.
- **Other Mac apps** (Mail, Messages, Slack): install [Finicky](https://github.com/johnste/finicky),
  copy `scripts/finicky.js` to `~/.finicky.js`, and set `defaultBrowser` in it to your browser.
  Video links go to Obsidian; everything else goes to the browser as before.
- **Inside the browser:** Settings → YouTube links → *Browser bookmarklet* → Copy. Make a
  bookmark and paste that as its address. Click it on a YouTube video tab.
- **iPhone:** build a Shortcut named *Open in YouTube for You*:
  1. Shortcuts → + → tap the (i) → turn on **Show in Share Sheet**; accept **URLs** and **Text**.
  2. Add **URL Encode** with *Shortcut Input*.
  3. Add **Text**: `obsidian://ytfree?url=` followed by the *URL Encoded Text* variable.
  4. Add **Open URLs** with that Text.

  Share any YouTube link (from the YouTube app, Messages, Safari) → *Open in YouTube for You*.
- **Anything else:** copy the link and run *Open YouTube URL from clipboard*.

## Quality

A video starts at 360p within a few seconds of pressing Play, then switches to HD (up to
1080p) while it keeps playing. Nothing is requested from YouTube before you press Play.
Settings → YouTube for You has switches for HD and for waiting until HD is ready before starting.

## Smart Speed

Skips the silences in a video and speeds through music, using the caption timing. Off by
default; turn it on per video from the player's controls, or for every video in settings.

## Tidying

Off by default. If you turn on *Tidy empty notes after* in settings, a video note you played
and never wrote in is moved to Obsidian's trash after that many days.

## Network use and privacy

YouTube for You talks to these services. Nothing else, and no telemetry: it sends no data about you
or your vault to its author or anyone else.

- **YouTube** (`youtube.com`, `i.ytimg.com`, `*.googlevideo.com`): video pages, streams,
  thumbnails, search, channel pages, transcripts and the RSS feeds of channels you subscribe
  to. The subscriptions hub checks those feeds on a timer while Obsidian is open (hourly by
  default; Settings → *Check every*). Requests are always signed out.
- **The YouTube for You player page** (`barkernotbob.github.io/obsidian-ytfree/player/`, served by
  GitHub Pages): only when a video plays in YouTube's own embedded player, which then loads
  from YouTube as usual.
- **A notification address you enter** (optional, blank by default): when you fill it in, new
  videos are POSTed there.

**Optional desktop helpers.** YouTube for You needs nothing installed. If
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) or `ffmpeg` is already on your computer, YouTube for You
runs them on desktop for offline downloads and finer Smart Speed. They are separate programs
you install yourself; YouTube for You never downloads or installs them
([details](docs/DESKTOP-HELPERS.md)).

**Files outside your vault.** Only if you use offline downloads (desktop, needs yt-dlp):
downloaded videos go to a `YT Free` folder in Movies (Videos on Windows and Linux), or the folder
you choose in settings. (Versions before
sign-in was removed kept a cookie file in `~/Library/Application Support/obsidian-ytfree/`;
YouTube for You deletes it on first load.)

**Accounts and payments.** No account and no sign-in; nothing is paid for. Your YouTube
cookies never reach the plugin.

**Ads.** YouTube for You shows no ads of its own.

## Using more than one device

The hub, watch time and watch history are plain JSON files in
`.obsidian/plugins/ytfree/`, synced by whatever syncs your vault (iCloud, Obsidian Sync,
Google Drive, Dropbox, Syncthing). Each device merges the other's changes and re-sends
anything a sync collision dropped, so two devices end up identical (docs/V1-SCOPE-SYNC.md).
How fast a change crosses is up to your sync service; once the file arrives, an open hub
shows it within 5 seconds.

That folder is hidden. **Obsidian Sync** carries it only with *Settings → Sync → Installed
community plugins* on, and some Google Drive and phone sync apps skip hidden folders unless
told otherwise. If the hub never matches between devices, check that first.

## Known limitations

- YouTube for You reads YouTube through interfaces YouTube does not document. When YouTube changes
  them, playback through our own stream can stop until the plugin is updated. Until then
  videos play in YouTube's embedded player.
- Pop-out windows (a note dragged out to its own Obsidian window on desktop) are not supported
  yet: play videos in the main window.
- Offline downloads are desktop only and need yt-dlp ([details](docs/DESKTOP-HELPERS.md)).

## Developing

See [docs/DEVELOPING.md](docs/DEVELOPING.md).

## License

[MIT](LICENSE)
