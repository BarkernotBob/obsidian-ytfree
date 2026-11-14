# V1 scope: channel paging, Preview → channel, smoother search loading

**Written:** 2026-11-14, from Isaiah (2026-11-14): Preview won't open a video's channel; a
channel's list stops at 80 videos while regular search goes further; search should load in
even-numbered batches and load the next page on its own at the bottom.

**Status:** draft, awaiting Isaiah's answers to D1-D3. Nothing built yet.

## Triage (store MVP, see [V1-SCOPE-MVP](V1-SCOPE-MVP.md))

| # | Ask | Call | Why |
|---|---|---|---|
| A | Preview → channel doesn't open | **MVP** | A visible link that does nothing is a broken feature. |
| B | Channel list stops at 80 | **MVP** if it is our bug; post-MVP if YouTube itself stops | A channel screen that can't show the catalogue fails its one job ([V1-SCOPE-CHANNEL-SCREEN](V1-SCOPE-CHANNEL-SCREEN.md)). |
| C1 | Even-numbered batches | **Post-MVP** | Cosmetic (a gap at the end of the two-up phone grid). Costs no requests. |
| C2 | Auto-load at the bottom | **Post-MVP** | Nice to have; "More" works. Touches the same code as open PR #104. |

C1 and C2 are small. If Isaiah wants them in the MVP anyway, they go in after #104 merges, on
top of it, so the two PRs don't fight over `loadMore`.

## What the code does today (main 18e5ec1)

- **Preview's channel link** (`PreviewModal.onOpen`, `src/hub.ts`) is drawn only when the video
  has a `channelId`. It is plain text when the id is missing (search results whose byline has no
  `browseEndpoint`) and, by design, when you are already on that channel's screen. Tapping it
  closes the sheet and calls `showChannel`. Nothing in the code explains a link that is drawn but
  does nothing, so D1 asks what Isaiah saw.
- **Channel paging** (`loadChannel`, `loadMoreChannel`, `parseChannelResponse` in
  `src/channel.ts`): there is no 80 cap in our code. Paging stops when YouTube sends no
  continuation token, or when a page yields no new card (`fresh.length === 0`). The second rule
  also stops on a page the parser can't read (a new item shape), which would look exactly like
  a cap. The Videos tab answers 30 per page, so 80 shown is not a page boundary: either some
  cards were dropped (members-only, age-restricted, hidden) or this was a search inside the
  channel, whose page size we have never recorded past page one (the fixture has 13 results and
  no token).

## v1

### A. Preview → channel

1. The channel name in Preview is always a link when the video has a channel name, even when
   the `channelId` is missing. A tap with no id looks it up first (one player call, the same one
   `openVideoChannel` in `src/main.ts` already makes, cached), then opens the channel.
2. Plus the fix for whatever D1 shows.
3. Test: a Preview spec with a channel name and no id still gets a working `openChannel`.

### B. Channel paging to the end

1. "More videos" keeps going while YouTube sends a token. A page with nothing new no longer ends
   the list if it came with a token: we read one more page (max 2 empty in a row, then stop and
   say so), so a parser miss can't silently cap the catalogue.
2. If the recording (D2) shows a new item shape, the parser learns it.
3. If the cap is YouTube's own (channel search stops sending tokens), the end of the list says
   "YouTube shows up to N matches here. Scroll the channel's videos to see the rest" instead of
   just ending. Pulling the whole catalogue to search it ourselves costs one request per 30
   videos and is out of v1.
4. Tests: continuation fixtures from D2; the two-empty-pages rule.

### C1. Even batches (if picked)

When a page lands with an odd number of cards, hold the last card back and show it with the
next page. At the true end, show everything. No extra requests. Applies to search and channel.

### C2. Auto-load at the bottom (if picked)

1. When the More button comes within about one screen of view, it loads, as if tapped. The
   button stays as the fallback.
2. **Request safety, same cost as tapping:** one page in flight; at least 2 seconds between
   automatic loads; a load fires only after a real scroll (a short list that fits on screen does
   not chain-load itself); never while the bot-check pause (`src/bot-check.ts`) is on; after
   any error it goes back to the button.
3. After 10 automatic pages in a row (about 200-300 videos), it stops and shows the button,
   so a fast flick through a 2,000-video channel can't fire 60 requests.

## Decisions for Isaiah

- **D1. Preview bug.** Where did you open Preview (hub, search, a channel screen, a note link),
  and what happened: the channel name wasn't tappable, or tapping did nothing?
- **D2. The 80 cap.** Was it the channel's own video list ("More videos"), or a search inside
  the channel? And which channel? Then one recording run from the Mac Terminal, about 6
  requests once (like the #104 run), to see where YouTube stops. Recommended: yes.
- **D3. C1 and C2: MVP or post-MVP?** Recommended: post-MVP (issue filed), built right after
  #104 merges.

## Not in v1

- Searching a channel's full catalogue ourselves.
- Sorting the channel list (oldest first, most viewed).
