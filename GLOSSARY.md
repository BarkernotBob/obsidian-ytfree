# GLOSSARY

Terms this repo uses, and the decisions behind them. A decision lands here the day it is made,
with who made it. Ticket detail stays in `issues/` and GitHub issues.

## Terms

- **Hub**: the subscriptions screen. Chips: Inbox, In progress, Kept, All, Hidden.
- **Inbox**: hub items not yet opened, kept or hidden.
- **Kept**: hub items you opened or saved. Not the same as "has a note" (see 017).
- **Hidden**: the drawer for hub mistakes. Never holds search removals (see 047).
- **Feed poll**: the hourly check of each subscribed channel's RSS feed, a rolling window of 15
  uploads by that channel only.
- **Account sync**: desktop-only, signed-in, every 12 hours, through yt-dlp with cookies:
  subscriptions, Watch Later, history.
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

## Decisions

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

### Earlier

- `PROGRESS_TTL_DAYS` stays 365 (2026-09-02).
- In progress floor is `min(0.1 × duration, 120s)`, backed by `progress.json` (2026-08-06).
- Subscribe opens the channel in the external browser; no authenticated writes (2026-08-06).
