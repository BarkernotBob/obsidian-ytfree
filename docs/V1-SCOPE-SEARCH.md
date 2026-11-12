# V1 scope: search fixes for the store (#46)

**Written:** 2026-11-12, from #46 (Isaiah, 2026-11-07): "Related to your search" should go, the
**Uploaded** and **Sort by** filters seem to do nothing, and the whole search path needs a review.
MVP item M5 in [V1-SCOPE-MVP](V1-SCOPE-MVP.md).

**Status:** draft. The open decisions (D1, D2) are with Isaiah. Nothing is built yet.

## What the code does today (main bd069ef)

Query → `searchYouTube` (`src/innertube.ts`, ANDROID client, `params` from
`src/search-params.ts`) → `parseSearchResponse` (`src/search.ts`) → `fetchPage`, `runSearch`,
`loadMore` and `resultHost` (`src/hub.ts`).

The recorded page one in `tests/fixtures/search-android.json` (query "smarter every day", no
filters) looks like this:

| Section | Contents | How we draw it |
|---|---|---|
| 0 | chip cloud, ad | ignored |
| 1 | ad + **7 videos** | "Results" |
| 2 | shelf | ignored |
| 3 | **2 videos** | "Related to your search" |
| 4 | shelf | ignored |
| 5 | **10 videos** | "Related to your search" |

The continuation page is one section of 20 videos, all drawn as "Results".

## Why the filters look broken (inferred from code and the 2026-07 spike, not measured live)

1. **Only section 1 is filtered and sorted.** The 2026-07 spike (`docs/spikes/search-filters/sections.mjs`)
   found sort applies to the first section only. So a sorted or date-filtered search shows about
   7 correct results, followed by about 12 that ignore the filter. The 12 make the whole list
   look unfiltered. This is the most likely cause of what Isaiah sees.
2. **Our own heading misleads.** On a plain search, sections 3 and 5 in the fixture are ordinary
   matches (all "Smarter Every Day" videos), not related material. "Related to your search" is
   our label, not YouTube's.
3. **Not ruled out:** YouTube may have stopped applying `params` on the ANDROID client since the
   spike (2026-07-28). No current recording exists, so this can't be checked in the code.

## v1

1. **No "Related to your search" heading, ever.** One list of results.
2. **Sections after the first:** see D1.
3. **Filters still apply on "More results".** The continuation token carries the filters. A
   recorded continuation must show this (see D2).
4. **The "already in your hub" skip, its 4-page budget, dedupe across pages, the blocklist and
   the empty and error states stay as they are.** The review found nothing wrong with them (`acceptable`, `fetchPage`, `searchScreen`).
5. **Tests:** parser tests for the new section rule against recorded fixtures (plain, sorted,
   date-filtered, and a continuation of a filtered search), plus a hub test that no heading is
   drawn.
6. **No new request per search.** v1 sends the same requests as today: one per search, one per
   "More results", and the existing up-to-3 extra pages when everything is already in the hub.

## Open decisions

- **D1. What happens to the results after the first section?**
  Recommended: **merge them into the list on a plain search, and drop them when any filter or
  sort is set.** A plain search then reads like YouTube's own app and keeps all ~19 results. A
  filtered search shows only results that match, about 7 on page one with "More results" for the
  rest.
  The alternatives are to always drop them (thin page one even on a plain search), or to always
  drop them and fetch page two automatically (one extra request per search, against the #66 budget).
- **D2. One small recording run to confirm the filters still work.** Recommended: **6 searches
  from the Mac, one time only, through the plugin's own request code:** "smarter every day" plain,
  Sort by upload date, Sort by view count, Uploaded this week, and "More results" on the last two.
  That is about what a person does in one minute of searching. The responses become test
  fixtures, and no probing happens after that. The alternative is to build blind and let Isaiah's device test find out.

## Known limitation (unchanged, from issue 008)

- A sorted list can contain a couple of promoted videos YouTube injects. Nothing in the response
  marks them, so they stay.

## Not in v1

- Autocomplete, search history, channel and playlist results, re-sorting results ourselves.

## Manual test (after the build)

1. Hub → Search → type `smarter every day` → Enter. One list, no "Related to your search" heading.
2. Set **Sort by → Upload date**. The list reloads, and the newest video comes first ("2 days
   ago" before "1 month ago"). Scroll to the end. Nothing older is mixed in above anything newer,
   except for the odd promoted video.
3. Tap **More results**. The new cards are also newest-first.
4. Set **Uploaded → This week** (Sort back to Relevance). Every card says hours or days ago,
   never weeks or years.
5. Set both back to the defaults. You get the full list back with no heading.
