# v1 scope — Browse YouTube inside Obsidian

Gate required before build. Written 2026-07-28.

**One sentence:** search YouTube from inside Obsidian, see results with no ads, no
recommendation shelves and no autoplay, and click one to land it in the hub — the video is
never playable from the browse surface.

**Smallest version a stranger gets value from:** a search box in the hub, results rendered
as the hub's own cards, one click adds the video to the hub as a normal item. Nothing
plays.

## The design decision, and why

Two ways to do this. They are not close.

| | A — embedded YouTube (`<webview>`) | B — YouTube's own API, our UI |
|---|---|---|
| How | reuse the sign-in `<webview>`, intercept navigation to `/watch` and cancel it | POST `youtubei/v1/search` via `requestUrl`, render results ourselves |
| Ads | homepage/search ad shelves are still there — you just never reach a preroll | **none** — measured: zero ad or promoted renderers in the response |
| Recommendation shelves | present, and they are the rabbit hole this plugin exists to avoid | absent, by construction |
| Fragility | URL interception + Google changing the page under us | one JSON shape, same InnerTube surface the player already depends on |
| Platform | desktop only — no `<webview>` on iOS | **desktop and mobile**, same code, `requestUrl` exists on both |
| Sign-in | required | not required |

**B.** A is the thing that sounds like "browse YouTube" and is the worse product: it drags
the whole YouTube UI — shelves, ads, autoplay previews — into Obsidian, only to spend code
fighting it. B is less work, less fragile, works on the phone for free, and the ad-free
result is a property of the design rather than a filter that has to keep winning.

A is not dead — it is the right answer *later* for the things an API call can't do (a
channel's full back catalogue, playlists you own). It becomes a v2 ticket, not v1.

## Verified foundations (measured 2026-07-28, before any code)

| Fact | Evidence |
|---|---|
| `POST youtubei/v1/search` works with **no auth, no API key** | ANDROID client → HTTP 200, 1.4 MB |
| Results are ad-free | 18 `compactVideoRenderer`, zero `promoted*` / `adSlot*` renderers in the payload |
| Per result: id, title, channel, channel ID, published, views, thumbnail | `videoId`, `title`, `longBylineText.runs[0].navigationEndpoint.browseEndpoint.browseId`, `publishedTimeText`, `viewCountText`, `thumbnail.thumbnails` |
| Results carry **duration** — the feed does not | `lengthText.runs[0].text` = `"55:31"` |
| Results do **not** carry the description on the ANDROID client | `descriptionSnippet` empty; WEB's `detailedMetadataSnippets` is a truncated snippet, not the description |
| Paging exists | ANDROID `nextContinuationData`; WEB `continuationItemRenderer` + token |
| Same request shape the player already uses | `src/mobile/innertube.ts` — client context + `User-Agent` pairing is already solved |

## In scope for v1

### 1. Search, in the hub
- A search field in the hub's header. Enter runs the search.
- Results render as the hub's existing cards, in a **Search** mode that replaces the item
  list while active. Clearing the box returns to the normal hub.
- Per result: thumbnail, title, channel, age, views, **duration**.
- No player, no preview, no hover-play, no thumbnail that is secretly a link to YouTube.
  There is exactly one thing a result can do (§2).
- Paging: one **More results** button, appending. No infinite scroll.

### 2. Click → hub item, not a note and not a video
- Clicking a result adds a `HubItem` with `origin: "search"` and `state: "new"`, and the
  card flips to a "in your hub" marker **in place** — per the global rule, nothing reflows.
- Already in the hub → the card says so and the click is a no-op. Never a duplicate.
- The item then behaves exactly like a feed item: it shows in the hub, and clicking it
  *there* creates the Watch Later note and pins the player. Browse adds; the hub decides.
- **Description is fetched at add time**, one `youtubei/v1/player` call for
  `videoDetails.shortDescription`, because search does not carry it and the hub's whole
  premise is that the description is cached before it can go stale. A failed fetch stores
  an empty description and adds the item anyway.
- `origin: "search"` items never expire. You asked for this one by name.

### 3. Nothing else changes
- No new storage file. `SubscriptionsState.items` gains one more `ItemOrigin`.
- No sign-in requirement, and search must keep working signed out.

## Explicitly NOT v1 (→ v2 tickets)

- The embedded `<webview>` browser (option A), and with it channel back-catalogues,
  playlists, and anything that needs the real YouTube page.
- Search filters (upload date, duration, sort) and YouTube's chip cloud.
- Search suggestions / autocomplete.
- Searching *within* the hub's existing items — different feature, same box, confusing.
- Channel pages. Adding a channel by search result is a v2 ticket; today you paste a URL.
- Shorts probing on search results. Search states duration; a v2 ticket can use it.

## Known hard limitations (accept, do not attempt to fix in v1)

- The response is an undocumented renderer tree. It can change without notice, exactly as
  the player endpoint can. Same blast radius, same mitigation: parse defensively, degrade
  to "no results" rather than throwing, and keep the parser pure and fixture-tested.
- Unauthenticated results are not personalised. That is the point, but it does mean search
  will not surface a private or unlisted video you can otherwise see.
- One extra HTTP request per add, for the description.
- `hl`/`gl` are pinned to `en`/`US`, as everywhere else in this plugin.

## Acceptance criteria

1. Typing a query in the hub and pressing Enter shows results within a couple of seconds,
   signed out.
2. Every result shows thumbnail, title, channel, age, views and duration.
3. No result can start playback by any interaction — click, double-click, or hover.
4. Clicking a result adds it to the hub with its description populated, and the card's
   marker changes without a single pixel of surrounding layout moving.
5. Clicking the same result again does not create a second item.
6. That item appears in the hub's normal list, and clicking it there creates the Watch
   Later note and pins the player, identically to a feed item.
7. A search-origin item is still present after an expiry run that removes a feed item of
   the same age.
8. Clearing the search box restores the hub exactly as it was, including the active filter.
9. A malformed or empty response shows "No results" and never throws.
10. The same search works on iPhone (`requestUrl`, no `<webview>` involved).

## Manual test (for BarkernotBob)

Written when the issue is completed, not before.
