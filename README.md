# YouTube for You

Watch YouTube inside Obsidian, without the ads, and take notes that link back to the exact
moment. Follow your channels, search, read transcripts and pick up where you left off, on
desktop and on your phone. Nothing else to install.

YouTube for You is an independent project. It is not affiliated with, endorsed by or sponsored by
YouTube or Google.

## What you get

- **An ad-free player.** Videos play in a plain video player inside your note, with
  Picture-in-Picture, full screen and playback speed. If a video can't be played that way, it
  falls back to YouTube's own player in the same spot (see [Ads](#network-use-and-privacy)).
- **Notes that point at the video.** Start typing and each new line gets a clickable timestamp.
  Click it to jump back to that moment.
- **A subscriptions hub.** Import your channels from YouTube, and new videos land in an Inbox.
  In progress, Saved and History lists keep track of the rest.
- **Search** all of YouTube from inside Obsidian.
- **Transcripts** in the note, in clickable paragraphs, plus the video's most-replayed moments.
- **Pick up where you left off**, on any device, with watch progress and history synced through
  your vault.
- **Skip pauses** (optional): jumps over the stretches where nobody is talking.
- **New-video alerts** (optional) to your phone.

## Quick start

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **YouTube for You**,
   then **Install** and **Enable**.
2. Click the YouTube for You icon in the left ribbon to open the hub. Search for a video, or
   **Import from YouTube** (Settings → YouTube for You → Subscriptions) to bring in your channels.
3. Click a video. Its note opens with the player pinned at the top. Press Play and start typing.

Already have a YouTube link? Copy it and run **Open YouTube URL from clipboard** from the command
palette.

## Getting videos in

- **Links in your notes:** a YouTube link clicked in a note opens here, at its timestamp.
  (Settings → YouTube for You → Links → *Open YouTube links here*.)
- **A player in any note:** put a YouTube link in a `ytfree` code block:

  ````
  ```ytfree
  https://www.youtube.com/watch?v=dQw4w9WgXcQ
  ```
  ````

- **Web Clipper:** import `templates/webclipper-ytfree.json`. It fires on any
  `youtube.com/watch` page. Re-import it after updating the plugin.
- **Templater:** `templates/templater-ytfree.md` asks for a link and builds the note.
- **From the browser:** Settings → YouTube for You → Links → *Browser bookmarklet* → **Copy**.
  Save it as a bookmark's address, then click it on any YouTube video.
- **From iPhone apps** (YouTube, Messages, Safari): make a Shortcut named *Open in YouTube for
  You*:
  1. Shortcuts → **+** → tap **(i)** → turn on **Show in Share Sheet**, accepting **URLs** and **Text**.
  2. Add **URL Encode** with *Shortcut Input*.
  3. Add **Text**: `obsidian://ytfree?url=` followed by the *URL Encoded Text* variable.
  4. Add **Open URLs** with that Text.

  Then share any YouTube link → *Open in YouTube for You*.
- **From other Mac apps** (Mail, Messages, Slack): install
  [Finicky](https://github.com/johnste/finicky), copy `scripts/finicky.js` to `~/.finicky.js`, and
  set `defaultBrowser` in it to your browser. Video links go to Obsidian; everything else goes to
  the browser as before.

Every route above uses `obsidian://ytfree?url=<YouTube link, URL-encoded>`, which you can use
from anything else too.

### Commands worth a hotkey

| Command | What it does |
|---|---|
| Insert timestamp at cursor | Writes a clickable `[12:34]` link at the current playback time |
| Open YouTube URL from clipboard | Opens (or makes) the copied video's note, at its timestamp |
| Open subscriptions hub | Opens the hub |
| Search YouTube for new videos | Opens search |
| Fetch transcript and most-replayed moments | Adds them to an older note |

## Settings

Settings → YouTube for You has seven pages: **Playback** (HD, Skip pauses, pause while typing),
**Notes** (timestamps, the pinned player, where new notes go), **Transcripts**,
**Subscriptions**, **Alerts**, **Links** and **Advanced**. The defaults suit most people.

- **Quality:** a video starts at 360p within a few seconds, then sharpens to HD (up to 1080p)
  as it plays. Nothing is requested from YouTube before you press Play.
- **Clean up empty notes** is off by default. When on, a note for a video you played but never
  wrote in goes to Obsidian's trash after the number of days you set.

## Using more than one device

The hub, watch progress and history are plain files in `.obsidian/plugins/ytfree/`, synced by
whatever syncs your vault (iCloud, Obsidian Sync, Google Drive, Dropbox, Syncthing). Each device
merges the other's changes, so they end up the same. Once a change arrives, an open hub shows it
within 5 seconds.

That folder is hidden. **Obsidian Sync** carries it only with *Settings → Sync → Installed
community plugins* on, and some sync apps skip hidden folders unless told otherwise. If the hub
never matches between devices, check that first.

## Network use and privacy

YouTube for You talks to these services. Nothing else, and no telemetry: it sends no data about
you or your vault to its author or anyone else.

- **YouTube** (`youtube.com`, `i.ytimg.com`, `*.googlevideo.com`, and YouTube's image hosts such
  as `yt3.ggpht.com`): video pages, streams, thumbnails, search, channel pages, transcripts, and
  the feeds of channels you subscribe to. The hub checks those feeds on a timer while Obsidian
  is open (hourly by default; Settings → Subscriptions). Requests are always signed out.
- **The YouTube for You player page** (`barkernotbob.github.io/obsidian-ytfree/player/`, served
  by GitHub Pages): only when a video falls back to YouTube's own player, which then loads from
  YouTube as usual.
- **An alert address you enter** (optional, blank by default): when you set one, new videos are
  posted there.

**Your files.** YouTube for You runs no other program and reads or writes nothing outside your
vault. Its own data is in `.obsidian/plugins/ytfree/`. (Older versions that had YouTube sign-in
kept a cookie file in `~/Library/Application Support/obsidian-ytfree/`. If you used it, delete
that folder by hand.)

**Accounts and payments.** No account and no sign-in; nothing is paid for. Your YouTube cookies
never reach the plugin.

**Ads.** YouTube for You shows no ads of its own, and its own player has none. When a video falls
back to YouTube's player, that player is YouTube's and YouTube may show ads in it.

## Known limitations

- YouTube for You reads YouTube through interfaces YouTube does not document. When YouTube changes
  them, the ad-free player can stop working until the plugin is updated. Until then, videos play
  in YouTube's own player.
- No offline downloads. Videos always stream.
- Pop-out windows (a note dragged into its own Obsidian window on desktop) are not supported yet.
  Play videos in the main window.
- Shorts are told apart from regular videos only by length, so a video under 3 minutes may show
  as a Short.

## Developing

See [docs/DEVELOPING.md](docs/DEVELOPING.md).

## License

[MIT](LICENSE)
