# V1 scope: channel paging, Preview → channel, smoother search loading

**Written:** 2026-11-14, from Isaiah (2026-11-14): Preview won't open a video's channel; a
channel's list stops at 80 videos while regular search goes further; search should load in
even-numbered batches and load the next page on its own at the bottom.

**Status:** answered by Isaiah 2026-11-14 (see Decisions). A and B built on PR #117; C1/C2 post-MVP (#118).

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
   the list if it came with a token: the same tap reads one more page (2 empty in a row, then it
   stops), so a parser miss can't silently cap the catalogue. Worst case 2 requests per tap.
2. If the recording (D2) shows a new item shape, the parser learns it.
3. At the end of the catalogue, the status line says "N shown · end of the Videos tab
   (YouTube's 112 videos also counts Shorts and live streams)" instead of "N shown of 112 videos".
   Shorts and Live tabs on the channel screen are post-MVP. Pulling the whole catalogue to search it ourselves costs one request per 30
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

**Answers (Isaiah, 2026-11-14):** D1: the channel name wasn't tappable at all. D2: the channel's
own list (More videos) on his subscription Mike Schmitz; the header said 100-some videos, More
stopped at 80. No recording run. D3: after the MVP.

**What that points to (inference, not measured):** an untappable name means the video reached
Preview with no channel id (note-only and History cards never carry one), or Preview was opened
on that channel's own screen. For the cap, the header's count includes Shorts and live streams,
which the Videos tab doesn't list, so the list most likely really ended. v1 covers both readings:
A1 makes the name always tappable, B1 stops a bad page from ending the list, and B3 now says at
the end that the header counts Shorts and live streams.

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

## Manual test (phone and Mac)

1. Hub → tap a subscription card → Preview. The channel name under the title is blue. Tap it:
   Preview closes and that channel's screen opens.
2. Open a video from History, or a note-only card in In progress, → Preview. The channel name is
   blue. Tap it: after a moment the channel's screen opens.
3. On Mike Schmitz's channel screen, tap More videos until it goes away. The line at the top
   then says "… shown · end of the Videos tab (YouTube's … also counts Shorts and live streams)".
4. On that channel screen, Preview one of its videos and tap the channel name: Preview just
   closes and you stay on the channel.
