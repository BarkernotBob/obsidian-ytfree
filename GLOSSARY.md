# GLOSSARY

Terms this repo uses, and the decisions behind them. A decision lands here the day it is made,
with who made it. Ticket detail stays in `issues/` and GitHub issues.

## Terms

- **Synced file** (`src/synced-file.ts`): a JSON file both devices write through a sync
  service. Merge on save, write back on read when the file is missing something, a
  device-local copy (`ytfree-sync-*` in app local storage), conflict copies merged then deleted.
- **Write-back**: a device re-saving because a read showed the file lost one of its decisions
  (a sync collision). Backs off from 15 s to 5 min if writes keep crossing.
- **Cleared** (`progress.json`): dated mark that a video's position was finished/reset, so the
  other device's older position cannot bring it back.
- **Drained** (`progress.json`): watch stamps already handed to `history.json` (#48), so a
  merge with an older copy cannot bring them back and restart the hand-over every save.

- **Hub**: the subscriptions screen. Chips: Inbox, In progress, Saved, Hidden, Everything.
- **Inbox**: hub items not yet opened, kept or hidden.
- **Saved** (chip; `kept` in code): hub items you opened or saved. Not the same as "has a note" (see 017).
- **Hidden**: the drawer for hub mistakes. Never holds search removals (see 047).
- **Feed poll**: the check of a subscribed channel's RSS feed, a rolling window of 15
  uploads by that channel only. Every channel, every 60 minutes, 5 at a time, stalest first;
  Sync now checks every channel too. A channel's first check after an import seeds its videos
  without sending a notification. Code: `src/feed-schedule.ts`.
- **Feed torture test** (GitHub #66, 2026-11-09, Isaiah's ask): `scripts/feed-torture.ts` on his Mac,
  home Wi-Fi. 3,710 feed requests (18 and 300 channels; 300 at once, 900 back to back, 1,800 over
  30 min, one feed ×100) with zero failures, no bot check, and video lookups fine after each. So
  the poll rounds and 120-feeds-an-hour ceiling built in #70 were removed, and the default poll
  went back to 60 min. One home IP on one day; a shared IP may differ.
- **Nothing before Play** (GitHub #66): opening a note or a preview sends no request on any device.
  The desktop shows a poster and resolves on Play, like the phone (Isaiah dropped "HD ready before
  Play", 2026-11-09). The badge reads "· HD on Play" until then; "finding HD…" only while a lookup runs.
- **First-run defaults** (GitHub #66): phone stream warm-up on note open off; auto-transcript stays
  on; most-replayed stays on (Isaiah, 2026-11-09). Existing installs keep their saved settings.
- **Account sync**: removed 2026-11-09 (GitHub #64). There is no YouTube sign-in; subscriptions
  come from adding a channel and the Google Takeout `subscriptions.csv` import.
- **Channel screen**: one channel's whole uploads catalogue via InnerTube `browse` with
  continuation, with a search box over it (045).
- **Collab video**: a video uploaded by channel A that lists subscribed channel B as a
  collaborator. Never in B's RSS feed or B's Videos tab; it is in your subscription feed
  (GitHub #2). Hub items from there carry `origin: "collab"`.

- **Stitched HD**: YouTube's separate picture and sound MP4 files, described as byte ranges in an
  HLS playlist built in memory from each file's `sidx` index, played by hls.js. Streaming, not a
  download (`src/adaptive.ts`).
- **Desktop fallback**: when yt-dlp is missing or fails, the desktop resolves the way the phone
  does (InnerTube `ANDROID`, 360p).
- **Quality badge**: the chip on the picture's top-left corner that says where HD has got to
  (`360p · finding HD…`, `480p · HD loading`, `1080p`). Fades once settled (`src/hd-status.ts`).
- **Start in HD**: the setting that holds playback until HD is ready and starts it on the top
  rung, with a 15s fallback to 360p.

## Decisions

### 2026-11-10 (Isaiah: #72 is MVP, "Live Preview links")

- Plain times in a video note are drawn as seek links in Live Preview too, by a CodeMirror mark
  (`src/live-timestamps.ts`); the note text is never rewritten. Frontmatter, code and markdown
  links are skipped. Same setting as Reading view's links.

### 2026-11-09 (Isaiah, hub sync between devices; docs/V1-SCOPE-SYNC.md)

- Cross-device sync bugs are MVP. Target: edits ≥10 s apart end identical on both devices
  (hub status, watch time); nothing removed comes back. Delivery speed is the sync service's.
- Fix approved: write back what the file is missing, device-local copy, conflict-copy merge,
  5 s hub refresh + refresh on foreground, same rules for `progress.json`; `history.json`
  (#48) to use the same `src/synced-file.ts`.
- Other sync tools (Obsidian Sync, Drive, Syncthing): same fix; hidden-folder gap is a README
  note for MVP, visible folder post-MVP (#75).

### 2026-11-09 (Isaiah, watch history and stats, #48)

- **History**: a hub chip listing every video you have watched, newest first, with one line
  `N videos · Xh Ym watched`. Searchable by title and channel. Never cleared automatically.
  Scope: `docs/V1-SCOPE-WATCH-HISTORY.md`.
- **Watched** = the In progress floor, `min(2 min, 10% of the video)` played.
- **Watch time** = real time spent playing: pauses excluded, 2× counts half.
- Two files: resume positions stay in `progress.json`; the watch stamps move to `history.json`.
- All existing watch stamps are imported; stats start at 0, no "since" label.
- Remove one video from a History card's ⋯ menu; Clear history in settings (confirm) wipes all.
- Breakdowns (week / day / channel) and export are post-MVP (#73).
- Claude's calls (2026-11-09, open to change): Preview counts toward History and watch time;
  only a note player moves `playedAt`, the stamp the note tidy reads, so previewing never makes a
  note trashable. Remove on a History card is the card's Remove button (no ⋯ menu exists). Each
  device names itself with a random id in `localStorage` (`ytfree-device-id`) for its watch-time
  counter.

### 2026-11-09 (store compliance, #61; Claude's calls, open to change)

- License is MIT (package.json said ISC; Obsidian needs a LICENSE file, and MIT is the common
  choice in its directory).
- `minAppVersion` 1.6.6: `FileManager.trashFile` needs it. Obsidian's lint fails below that. Raised to 1.8.7 on 2026-11-10: see below.
- TypeScript is pinned to 5.9: typescript-eslint, which Obsidian's lint runs on, does not
  support TypeScript 7.
- Plugin logging is `console.debug` (Obsidian's rules allow only debug, warn and error), so the
  debug switch's lines show at the console's Verbose level.
- Regexes avoid lookbehind (iOS before 16.4 cannot parse it); a capture group stands in.
- Release tags are bare `x.y.z`; the old `v0.1.0` tag stays as history.

### 2026-11-07 (Isaiah, answering the #49/#50 scope)

- The **Kept** chip is now **Saved**, to match the Save button.
- **In progress** keeps a started video you removed from the hub while its note exists, and also
  shows started video notes the hub never had (older notes, Web Clipper). On those cards Remove
  says **Delete**, asks once, and moves the note to Obsidian's trash.

### 2026-11-04 (Isaiah asked; defaults picked by Claude, open to change)

- Per-video quality: a Quality row (HD / 360p) in the player's ⋯ pop-out overrides the HD
  setting for that video only. It never writes the setting and is kept until Obsidian quits,
  like the pop-out's other controls. Picking a rung (720p, 480p) stays with GitHub #15.

### 2026-11-06 (Isaiah)

- **Phone HD, part 2:** test YouTube's own embedded player (hosted page on GitHub Pages, opened
  from the Quality row on the phone) rather than HD through the Mac. Ads and YouTube's controls
  are the known costs; to be judged on the iPhone.

### 2026-11-04 (measured; Claude's call, open to change)

- **Phone HD (#25), part 1:** the phone asks IOS first and plays its HLS manifest with iOS's own
  player, never hls.js (googlevideo sends no CORS header). Measured 2026-11-04: that manifest
  exists on 1 of 5 videos and serves the whole video. PO token / BotGuard generation is out:
  Claude's safety check blocks it as bot-check circumvention. Part 2 (HD through the Mac on the
  home network) waits on Isaiah. Scope: `docs/V1-SCOPE-PHONE-HD.md`.

- Desktop HD comes from yt-dlp's files when InnerTube's stop serving after about a minute
  (`ytDlpFormats` + `resolveHdFromYtDlp`), stitched and streamed the same way. InnerTube is
  still tried first. Phone HD on most videos is GitHub #25.

### 2026-10-22 (Isaiah asked; defaults picked by Claude, open to change)

- HD progress is shown as stages and the rung playing, not a percentage: the HD resolve is a
  few network calls with no meaningful percentage. Plus a buffered-ahead band on the progress line.
- "Start in HD" is a setting, off by default, under the HD switch on each device. It waits at
  most 15s (`HD_WAIT_MS`), then plays 360p and sharpens later as before.
- With "Start in HD" on, a jump still drops to the lowest rung for its first chunk (Isaiah's
  rule of 2026-10-15 stands).
### 2026-10-22 (Isaiah reported; fix picked by Claude, open to change)

- **HD stutter at ~55 s and slow jumps**: treated as YouTube refusing a stream URL past its
  opening. The resolve now reads 1 KB past 90 s before trusting a pair, a refused segment
  mid-play is re-linked from a fresh client answer instead of failing to 360p, and stitched
  streams retry briefly. Scope: `docs/V1-SCOPE-HD-STUTTER-AND-SEEK.md`.
- **Re-link** (term): swapping a stitched stream's googlevideo links for fresh ones for the same
  files (same itag), keeping every byte offset (`relinkingFetch` in `src/adaptive.ts`).

### 2026-11-04 (Isaiah)

- **Keep playing on the phone**: leaving fullscreen, the collapse button, leaving Obsidian and
  locking the phone do not pause the video. Reverses the old "collapse pauses" rule. Whether iOS
  allows the background resume is unmeasured; see
  [docs/V1-SCOPE-KEEP-PLAYING.md](docs/V1-SCOPE-KEEP-PLAYING.md).

### 2026-11-07 (Isaiah)

- **Background pause stays resumable**: a video paused from the lock screen or AirPods stays ready
  to play for up to an hour (a silent loop keeps iOS from suspending Obsidian).
- **Now playing button, not auto-jump**: the lock-screen tile can't be told apart from the app
  switcher, so instead of jumping on return, a "▶ title" pill (phone) / status-bar item (desktop)
  takes you to the playing note. Isaiah's call.
- **No Now playing pill on the phone** (2026-11-07, #51): Isaiah saw it as a stray "video is playing"
  label and asked for it gone. The desktop status-bar item and the "Go to the playing video" command stay.
- **Properties re-collapse when Obsidian rebuilds them** (#51): collapsed once per table, not once per note.

### 2026-11-09 (Isaiah)

- **No YouTube sign-in (GitHub #64)**, for the Obsidian store MVP: the sign-in window, cookie
  file, account sync (subscriptions, Watch Later, history, collabs) and the "Try signed in"
  bot-check button are gone. No cookies reach yt-dlp or any request. The first load after the
  update deletes the old cookie file and the `persist:ytfree-account` partition and drops the
  `account*` settings. Old "watched" marks no longer hide hub items. The channel screen's
  Subscribe button (it relied on account sync) is gone until in-app subscribe (GitHub #65).

### 2026-10-19 (Isaiah)

- **Where a YouTube link lands**: the video's note if one exists, else its Preview. No setting,
  no `open=`, and a link never makes a note. Replaces the 2026-10-17 setting below and the
  separate *Preview YouTube URL from clipboard* command.
- **A followed link never auto-plays**: its timestamp is cued paused, in the note or the Preview.

### 2026-10-17 (Isaiah)

- **Paste to Preview (GitHub #10, #11)**: scope approved by answering its question. Links
  clicked inside a note open in Preview too: one setting, *YouTube links open in*, Preview by
  default, covers every route. `obsidian://ytfree?url=…&open=note|preview` overrides it per link.
  Decided while building: *Open YouTube URL from clipboard* still opens the note, and the new
  *Preview YouTube URL from clipboard* opens the Preview.

### 2026-11-04 (Isaiah asked; recommendations by Claude, approved by Isaiah 2026-11-07)

- Request volume to YouTube is a design constraint: one answer per video, one identity per
  device, cached, and stop after a bot check. No token generation, identity cycling or IP
  rotation. Research: docs/RESEARCH-YOUTUBE-REQUESTS.md, backlog #31–#39.
- **Bot check** (term): YouTube's "Sign in to confirm you're not a bot" (yt-dlp) or
  `LOGIN_REQUIRED` (InnerTube), refusing signed-out requests from a flagged IP.
- **Request savings** (#66, 2026-11-09): Smart Speed reads captions from Play's `yt-dlp -J` and
  shares the caption file with the transcript; desktop HD starts in 2 reads (index from the head,
  no 90 s check on yt-dlp files); no Shorts check for a video known to run over 3 min;
  most-replayed is filled on Play, and "none" is remembered on the device (`ytfree-no-heatmap`).
- **Bot-check pause** (Isaiah, 2026-11-09, #66): replaces the fixed 45 minutes. Automatic work
  (polls, backfills, HD lookups) stops until a request goes through. Only a Play retries our
  stream, the first Play after 1 min, then 5, 10, 30 min, 1 h, 2 h, then every 6 h. Nothing
  retries on a timer. A Play between retries sends nothing (YouTube's player once #43 lands).
- 2026-11-07: Isaiah agreed with all nine recommendations. #16 (InnerTube before yt-dlp) is
  closed as replaced by #32 (one `yt-dlp -J` per video). Scope: docs/V1-SCOPE-REQUEST-BUDGET.md.

### 2026-10-14 (Isaiah)

- **Preview (GitHub #8)**: fullscreen on the phone, not a card. Decided while building: the
  phone only; the tablet and desktop sheets are unchanged.
- **Preview, after the first phone test (GitHub #8)**: nothing tappable in the status bar;
  the Description and Transcript headers sit side by side under the player; while one is open
  the title, facts and the four buttons are hidden and the region takes the rest. Upright phone
  only; landscape unchanged.
- **Preview, after the third phone test (GitHub #8)**: the picture starts right at the safe
  area (the 59pt floor is gone); the close ✕ is on the picture's top-right corner, drawn by the
  plugin, and Obsidian's own close is hidden on a phone; an open header goes full width and the
  other one is hidden, both go back to half width when it is shut. Cause of three failed ✕ fixes:
  Obsidian renamed its close button from `.modal-close-button` (1.10) to `.modal-header-button`
  (1.14), so the CSS never matched. Verify phone layout against current Obsidian's app.css.
- **Fullscreen before the stream resolves (GitHub #9)**: it waits; a press does not go
  fullscreen until there is media, and the delay is acceptable. Replaces 038's "a cold press
  goes to the in-app fullscreen". Decided while building: the button is dimmed while it would
  wait, and a press on a player nobody started begins loading it without playing.
- **Paste to Preview (GitHub #10, #11)**: wanted, on phone and desktop. Scope written, not yet
  approved.
### 2026-10-15 (Isaiah asked; defaults picked by Claude, open to change)

- Desktop plays without yt-dlp by falling back to the phone's path; Download and Smart Speed
  still need yt-dlp.
- HD comes from stitched HD first, yt-dlp's HLS second. Cap 1080p, H.264 only. After Isaiah's
  first test: a ladder from 240p up, a jump lands low and climbs back, original-language audio
  only, and a broken HD stream drops to 360p rather than retrying. On by default on desktop; opt-in on the phone ("HD on this phone", iOS 17.1+).

### 2026-10-13 (Isaiah)

- **Manual tests**: every ticket built up to 046 is treated as passing. Status lines say so.
- **Watch Later (018)**: parked. Do not build or re-ask until Isaiah raises it.
- **Channel screen (045)**: the v1 scope in `docs/V1-SCOPE-CHANNEL-SCREEN.md` is approved as written.
- **Collab videos (GitHub #2)**:
  1. They should reach the hub without subscribing to the uploader.
  2. First chosen: check each subscribed channel's Videos tab. **Reversed the same day** after
     measuring: a channel's Videos tab does not list collabs it is on (Ward on Words' tab omits
     the RBN collab), and it cost about 1 MB per channel per check. Isaiah then chose the
     signed-in **subscription feed** during account sync, which does list it (145th of 800).
  3. Any video in that feed from a channel the hub doesn't poll gets in (origin `collab`),
     except channels removed in the hub or unsubscribed on YouTube, and deleted videos.
  4. The card names the uploader (what the feed reports). Collabs follow the same expiry setting as feed
     items (off by default), counted from when they arrived: the flat listing has no date.
- **Web Clipper (049)**: still in use. The template blockquotes the description, so a clipped
  note can never be broken by a fence, heading, quote or `[[` in it. The look changes (indented,
  quoted); readability alone is kept.
- **Search blocklist (047)**, decided while building: Remove on a search result lasts and syncs;
  removed videos also stay off channel screens; Hide channel filters search only; subscribing
  un-hides. Bounds 500 videos / 200 channels; undos kept 30 days. Newest decision per ID wins.
- **Backfill (048)**, decided while building: horizon is the expiry setting, or 30 days when
  expiry is off; at most 5 Videos-tab pages per gap; publish date from the player, never guessed.
- **YouTube links open in Obsidian (GitHub #3)**: wanted. Scoped in `docs/V1-SCOPE-URL-HANDOFF.md`
  and built. Decided while building: an existing note wins, including a Web Clipper note found
  by its `url` / `media_link` frontmatter; links in notes are intercepted by default (one
  setting); video links only, so a channel link still goes to the browser.
- **Handoff** (term): `obsidian://ytfree?url=…`, the door every outside router uses.

- **Halfway thumbnails** (2026-11-07): cards and the phone poster show YouTube's own halfway
  still (`hq2.jpg`), as HackerTube does, falling back to the uploaded thumbnail when it is
  missing. Shorts keep the uploaded picture. No setting. Scope:
  `docs/V1-SCOPE-MIDFRAME-THUMBNAILS.md`.

- `obsidian://ytfree?view=subscriptions|search` opens the hub; bare `obsidian://ytfree` opens the hub; `url=` wins over `view=` (2026-10-21).

- Phone ⋯ menu (#52): moves to `document.body` while open, sits at Obsidian's menu layer, avoids safe areas, scrolls when taller than the room (2026-11-07).

- **MVP** (Isaiah, 2026-11-09): the minimum to list YT Free in Obsidian's community directory.
  Labels `mvp` / `post-mvp`. Scope: `docs/V1-SCOPE-MVP.md`.
- **Store build** (Isaiah, 2026-11-09): ad-free, same as Isaiah's own. Ads were only meant to
  help acceptance, and Obsidian doesn't require them. Own stream first, YouTube's embedded player
  as fallback (#43). No separate local build for now (#60 post-MVP).

- **Playback tiers** (Isaiah, 2026-11-09): yt-dlp (desktop, if installed) → our own stream →
  YouTube's embedded player. After a bot check, straight to the embed.
- **Tier failure** (2026-11-10, #43 part 1): a tier fails for a video when it cannot resolve a
  link or its 360p link will not play before expiry; that video skips the tier for 30 minutes.
  Users are never told to install or update yt-dlp (Isaiah, 2026-11-10: "a user should never have
  to update YT DLP themselves").
- **YouTube's player as last tier** (#43, approved 2026-11-10): when every stream tier failed for
  a video, or on a bot check, YouTube's player replaces ours in place (hosted page, GitHub Pages),
  with "Try our stream again". Desktop never offers it as a menu choice.
- **No sign-in** (Isaiah, 2026-11-09): YouTube cookies never reach the plugin; subscriptions by
  manual add or Takeout CSV (#64, #65).
- **Subscribe in YT Free** (GitHub #65; details Claude's calls, open to change): adds the channel
  to the hub's list only, nothing sent to YouTube; videos arrive on the next feed check (no extra
  poll). On the channel screen the button turns into a greyed "Subscribed" of the same width;
  there is no unsubscribe there yet. A search card's ⋯ menu offers "Subscribe in YT Free" above
  "Hide this channel", and shows a greyed "Subscribed in YT Free" for a followed channel.

### Earlier

- `PROGRESS_TTL_DAYS` stays 365 (2026-09-02).
- In progress floor is `min(0.1 × duration, 120s)`, backed by `progress.json` (2026-08-06).
- Subscribe opens the channel in the external browser; no authenticated writes (2026-08-06). Removed 2026-11-09 with sign-in (#64).

### 2026-11-10 (hardening review; Claude's calls, open to change)

- `minAppVersion` is 1.8.7: `App.loadLocalStorage`, which `onload` calls, is public from that
  version ([V1-SCOPE-HARDENING](docs/V1-SCOPE-HARDENING.md), H1).
- TypeScript runs with `strict`, `noUnusedLocals` and `noUnusedParameters`. The code already
  passed `strict`; the switch keeps it that way.
- On Windows the plugin never rewrites the PATH it gives yt-dlp, and yt-dlp and ffmpeg are also
  looked for by bare name, last. Not tested on a Windows machine.

### 2026-11-10 (Notes button)

- **Notes button always folds the video** on the first press, as the reader's own fold: it stays
  until they tap Show video or Notes again, and does not come back when the keyboard goes. A
  fold the keyboard made does not count as folded, so Notes never reopens the video because of it.

### 2026-11-10 (one-tap YouTube player toggle, Isaiah)

- MVP. A YouTube button on the phone's control bar, first on the right, swaps between our player
  and YouTube's in one tap, keeping the second, speed and playing/paused. Phone, and desktop only
  when yt-dlp is missing (18:21: with yt-dlp the desktop gets HD from it). It replaces "Back to our player" and the Quality menu's "YouTube player (HD)"
  ([V1-SCOPE-YOUTUBE-TOGGLE](docs/V1-SCOPE-YOUTUBE-TOGGLE.md)).
- If iOS won't start YouTube's player with sound from our button, a tap on its play button is
  acceptable only once a fix is shown impossible; a muted start is not wanted.
- No pin button on the player's control bar (Isaiah, 2026-11-10): the collapse arrow is enough,
  and the room goes to the YouTube button. The pinned player is still on/off from the command
  palette and the settings tab.
- iPhone: YouTube's player can't be started from our button (measured 2026-11-11, even muted),
  so the first switch per video needs one tap on its play button; after that its frame is kept
  loaded behind ours so later switches start by themselves. Pages serves `gh-pages`, not `docs/`.



### 2026-11-10 (store defaults and helpers; Isaiah)

- **New installs start with the note tidy off and Smart Speed off.** An install that already
  has a `data.json` keeps what it was running with (`sanitizeSettings` in `src/settings.ts`).
- **Desktop helpers:** yt-dlp and ffmpeg. Hidden, not removed: nobody is asked to install
  anything, their settings sit in a folded section, and the instructions are in
  `docs/DESKTOP-HELPERS.md`. No Notice says yt-dlp is missing. Removing them is revisited
  after launch.
- **Pop-out windows** (a note dragged to its own desktop window) are not supported in the MVP.
- **Settings search** (Obsidian 1.13+) is MVP: the tab is data in `src/settings-tab.ts`,
  drawn by `getSettingDefinitions()` on 1.13+ and by `display()` before it.
- Lint warnings do not block a store release; only errors do
  ([V1-SCOPE-HARDENING](docs/V1-SCOPE-HARDENING.md), section 3).

### 2026-11-11 (hardening Batch 2; Claude's calls, open to change)

- `tools/` is now `scripts/`: Obsidian's scanner skips a folder with that name, so developer
  scripts stop counting against the plugin's scorecard.
- Releases carry build provenance, and Dependabot opens one grouped update a month per
  ecosystem. TypeScript stays pinned.
- The plugin's four data files are read together at load, not in sequence.

