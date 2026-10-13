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
  collaborator. Never in B's RSS feed (GitHub #2).

## Decisions

### 2026-10-13 (Isaiah)

- **Manual tests**: every ticket built up to 046 is treated as passing. Status lines say so.
- **Watch Later (018)**: parked. Do not build or re-ask until Isaiah raises it.
- **Channel screen (045)**: the v1 scope in `docs/V1-SCOPE-CHANNEL-SCREEN.md` is approved as written.
- **Collab videos (GitHub #2)**:
  1. They should reach the hub without subscribing to the uploader.
  2. Caught by checking each subscribed channel's Videos tab (InnerTube `browse`), not by
     reading the signed-in subscription feed, provided the cost stays small. This reverses the
     2026-08-06 rejection of the same approach.
  3. Any video on that tab that the hub doesn't already have gets in.
  4. The card's channel name is whichever is easier to get.
- **Web Clipper (049)**: still in use. The template blockquotes the description, so a clipped
  note can never be broken by a fence, heading, quote or `[[` in it. The look changes (indented,
  quoted); readability alone is kept.
- **YouTube links open in Obsidian**: wanted. Scoped in `docs/V1-SCOPE-URL-HANDOFF.md`.

### Earlier

- `PROGRESS_TTL_DAYS` stays 365 (2026-09-02).
- In progress floor is `min(0.1 × duration, 120s)`, backed by `progress.json` (2026-08-06).
- Subscribe opens the channel in the external browser; no authenticated writes (2026-08-06).
