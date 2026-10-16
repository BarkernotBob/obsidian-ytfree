# V1 scope: paste a YouTube URL, land in its Preview (GitHub #10, #11)

**Written:** 2026-10-14, from Isaiah's ask:

> 3. I want a way to paste in a youtube URL and go straight to that video in preview in YT Free
>    in obsidian on phone and desktop.
> 4. Stretch goal of the above, reroute all youtube URL's straight to obsidian when clicked, no
>    pasting into a special area needed.

**Status:** scope only, awaiting Isaiah's approval. Not built.

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
2. **Command:** *Preview YouTube URL from clipboard*. Opens the hub if needed, then the Preview.
3. **Preview for any video.** Today Preview needs a hub item or a search result for its title,
   channel and length. A pasted video has neither, so the sheet fetches them with
   `fetchVideoDetails` (the same call that already fetches a search result's description) and
   offers the search-result buttons: Watch, Keep, Share.
4. **The timestamp.** `t=` in the link seeks the Preview's player once it has media.
5. **One setting for item 4:** *YouTube links open in* Preview (default) or Note. The handler
   reads `obsidian://ytfree?url=…&open=preview|note`; without `open` it follows the setting. So
   in-note clicks, Finicky, the bookmarklet and the Shortcut all land in Preview with no change
   to their setup.

## Out of scope for v1

- A browser extension that rewrites every youtube.com click automatically.
- Anything that intercepts YouTube links on the iPhone without a tap.
- Playlists. A channel URL opening the channel screen is a separate ticket.

## Done when

- Pasting `https://youtu.be/-X4ZD3fisSs?t=90` into the hub's search box, on the iPhone and the
  Mac, opens that video's Preview fullscreen, starting at 1:30, with no note made.
- *Preview YouTube URL from clipboard* does the same.
- `obsidian://ytfree?url=…` with the setting on Preview opens the Preview; on Note, the note,
  as GitHub #3 shipped.
- A pasted channel URL searches; a pasted non-YouTube URL searches.
- Unit tests cover the search box's "is this a video link" decision and the `open=` parsing.

## Question for Isaiah

Should a link clicked **inside a note** also open the Preview, or keep opening the video's note?
Recommended: follow the same setting, so there is one answer everywhere.
