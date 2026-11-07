# V1 scope: paste a YouTube URL, land in its Preview (GitHub #10, #11)

**Written:** 2026-10-14, from Isaiah's ask:

> 3. I want a way to paste in a youtube URL and go straight to that video in preview in YT Free
>    in obsidian on phone and desktop.
> 4. Stretch goal of the above, reroute all youtube URL's straight to obsidian when clicked, no
>    pasting into a special area needed.

**Status:** approved 2026-10-17 (Isaiah: links in notes open in Preview too). **Built
2026-10-17**, awaiting manual test, below. `HubView.previewVideo` in `src/hub.ts`, `handoffTarget`
in `src/handoff.ts`, routing in `openYouTubeUrl` in `main.ts`.

## The one sentence

**Paste or click a YouTube link, on the phone or the Mac, and that video's Preview opens
fullscreen at the link's timestamp, with no note made until you press Watch or Keep.**

## What already exists (GitHub #3, merged 2026-10-13)

Most of item 4's plumbing is built; see [V1-SCOPE-URL-HANDOFF.md](V1-SCOPE-URL-HANDOFF.md).

- `obsidian://ytfree?url=…`, the door every outside route uses.
- Links clicked inside Obsidian are intercepted (one setting, on by default).
- Mac, other apps: Finicky (`tools/finicky.js`). Mac, inside the browser: a bookmarklet.
- iPhone: a four-action share-sheet Shortcut.
- Command *Open YouTube URL from clipboard*.

Every one of them lands in the video's **note**. That is the gap: none of them lands in Preview.

## Platform limits (these do not move)

- **iPhone:** no third-party app can take `youtube.com` universal links from the YouTube app or
  Safari. One tap in the share sheet is the floor. Paste is the other way in.
- **Mac:** only the default-browser slot can claim https links clicked in other apps; Finicky
  sits in it. Clicks inside the browser never leave the browser, so they need the bookmarklet
  or an extension.
- **Obsidian:** Preview is a modal opened from the hub. Opening it from a URL means the plugin
  must open (or focus) the hub first; on the phone that is one screen change before the
  Preview covers it.

## In scope

1. **Paste in the hub's search box.** A YouTube video URL typed or pasted into the search box
   opens that video's Preview instead of searching. Any URL shape `parseYouTubeLink` accepts.
   A non-video YouTube URL (channel, playlist) searches as it does today.
2. **Command:** *Open YouTube URL from clipboard* follows item 5's rule. (A separate *Preview*
   command was built and dropped on 2026-10-19 when the setting went.)
3. **Preview for any video.** Today Preview needs a hub item or a search result for its title,
   channel and length. A pasted video has neither, so the sheet fetches them with
   `fetchVideoDetails` (the same call that already fetches a search result's description) and
   offers the search-result buttons: Watch, Keep, Share.
4. **The timestamp.** `t=` in the link seeks the Preview's player once it has media.
5. **No setting for item 4** (changed 2026-10-19, Isaiah): every routed link, from a note,
   Finicky, the bookmarklet, the Shortcut or *Open YouTube URL from clipboard*, opens the
   video's note if one exists and its Preview if not. A link never makes a note.
6. **A followed link never plays by itself** (2026-10-19): the timestamp is cued, paused, in
   the note's player or the Preview's, and Play is still the reader's tap.

## Out of scope for v1

- A browser extension that rewrites every youtube.com click automatically.
- Anything that intercepts YouTube links on the iPhone without a tap.
- Playlists. A channel URL opening the channel screen is a separate ticket.

## Done when

- Pasting `https://youtu.be/-X4ZD3fisSs?t=90` into the hub's search box, on the iPhone and the
  Mac, opens that video's Preview fullscreen, starting at 1:30, with no note made.
- *Open YouTube URL from clipboard* does the same for a video with no note.
- `obsidian://ytfree?url=…` opens the note when there is one, else the Preview, and never
  opens the browser or makes a note.
- A pasted channel URL searches; a pasted non-YouTube URL searches.
- Unit tests cover the search box's "is this a video link" decision.

## Answered

Links clicked inside a note follow the same rule (Isaiah, 2026-10-17). The setting was replaced
by "note if one exists, else Preview" (Isaiah, 2026-10-19).

## Manual test (for Isaiah)

1. iPhone: paste `https://youtu.be/-X4ZD3fisSs?t=90` into the hub's search box. Its Preview
   opens at 1:30, paused. No note is made. (Passed 2026-10-19, before the pause change.)
2. Paste `https://www.youtube.com/@wardonwords`: it searches. (Passed 2026-10-19.)
3. In a note, tap a link to a video that has no note: the Preview opens, paused at the
   link's time. No note is made, and YouTube does not open.
4. Tap a link to a video that has a note: the note opens, its player paused at the link's time.
5. Copy a link to a video with no note, run *Open YouTube URL from clipboard*: the Preview opens.
6. In a Preview opened from a link, press Keep: the video lands in the hub's Kept list.
