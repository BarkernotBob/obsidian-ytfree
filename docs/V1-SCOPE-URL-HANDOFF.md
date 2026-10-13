# V1 scope — YouTube links open in Obsidian

**Written:** 2026-10-13, from Isaiah's ask:

> "A way for any youtube URL that I have to be able to be auto passed to obsidian rather than to
> youtube, and for it to open the video that URL is for."

Per the repo rule: the smallest version worth having. Everything under *Out of scope* is a v2
ticket, not a stretch goal.

## The one sentence

**Clicking a YouTube link anywhere on the Mac, or sharing one on the iPhone, opens that video's
note in Obsidian, at the link's timestamp, instead of opening YouTube.**

## The hard fact this is shaped around

Neither macOS nor iOS lets an app claim `https://youtube.com/...` links away from the browser.
A link always goes to the default browser (Mac) or to the YouTube app or Safari (iPhone, via
universal links). So "auto" needs two halves:

1. **A door into Obsidian** the plugin owns: `obsidian://ytfree?url=<any YouTube URL>`.
   Obsidian registers `obsidian://` with the OS, and plugins can claim an action under it
   (`registerObsidianProtocolHandler`). This half is code in this repo.
2. **Something that sends YouTube links to that door.** This half is configuration on each
   device, not code in this repo, and differs per platform.

## In scope

1. **The `obsidian://ytfree` handler.** Accepts every URL shape `extractVideoId` already
   accepts (`watch?v=`, `youtu.be/`, `shorts/`, `live/`, `embed/`, `m.youtube.com`, with or
   without `&t=`/`?t=`). It opens the video's existing note if one exists, else creates it
   exactly as a hub click does (same folder, same note builder, same hub item), then seeks to
   `t=` if the link had one. A URL with no video in it gets a Notice, not a blank note.
2. **YouTube links clicked inside Obsidian** open the same way instead of going to the
   browser. One setting, on by default, to turn it off.
3. **Mac: a router for links clicked in other apps** (Mail, Messages, Slack, Calendar).
   Recommended: [Finicky](https://github.com/johnste/finicky), a free, open-source default-
   browser stand-in that sends YouTube URLs to `obsidian://ytfree?url=…` and everything else
   to the real browser. The repo ships the few lines of Finicky config, and the README says how
   to install it.
4. **Mac: links clicked inside the browser itself.** Finicky never sees those. Ship a
   bookmarklet ("Open in YT Free") that sends the current tab to the handler. Works in Safari,
   Chrome, Arc and Firefox with no extension.
5. **iPhone: an "Open in YT Free" Shortcut** in the share sheet. Share any YouTube link from
   any app (including the YouTube app) and it opens in Obsidian. The repo ships the steps to
   build it; it is four actions.
6. **A command**: "Open YouTube URL from clipboard", for the case none of the above covers.

## Out of scope for v1 (the v2 tickets)

- **A browser extension** that rewrites every youtube.com navigation automatically. It would
  make in-browser clicks automatic, but it is a separate codebase, a store listing per browser,
  and it breaks the youtube.com you still sometimes want (Subscribe, comments).
- **Intercepting links on iPhone without a tap.** iOS universal links cannot be overridden by a
  third-party app. The share sheet is the honest version.
- **Playlists and channel URLs.** v1 opens videos. A channel URL could open 045's channel
  screen once it exists; that is a v2 ticket.
- **Opening the video without a note** (a preview-only mode). v1 always lands in a note, which
  is what the hub does.

## The stranger test

Someone who installed this today sets up Finicky and the Shortcut, gets a YouTube link in a text
from a friend, taps it, and is watching it ad-free in a new note in Obsidian, at the minute the
friend meant. They never saw youtube.com.

## Done when

- `obsidian://ytfree?url=https%3A%2F%2Fyoutu.be%2F-X4ZD3fisSs%3Ft%3D90` opens (or creates) that
  video's note and starts at 1:30.
- The same link clicked in Mail on the Mac does the same with Finicky installed.
- A YouTube link inside a note opens in YT Free, not the browser, and the setting turns that off.
- On the iPhone, sharing a YouTube link to the Shortcut opens it in Obsidian.
- A URL with no video ID shows a Notice and creates nothing.
- Unit tests cover the URL-to-(videoId, seconds) parsing for every shape above.

## Open question (does not block building)

Which browser is the Mac default? It only changes which bookmarklet instructions the README
leads with.
