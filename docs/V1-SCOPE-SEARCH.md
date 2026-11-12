# V1 scope: search fixes for the store (#46)

**Written:** 2026-11-12, from #46 (Isaiah, 2026-11-07): "Related to your search" should go, the
**Uploaded** and **Sort by** filters seem to do nothing, and the whole search path needs a review.
MVP item M5 in [V1-SCOPE-MVP](V1-SCOPE-MVP.md).

**Status:** answered by Isaiah 2026-11-12. D1: drop the later sections and load page two
automatically. D2: one 6-search recording run from the Mac. Built on PR #104.

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
2. **Sections after the first are dropped** (D1). They are never drawn, under any heading.
   **A new search reads page one and page two in one go,** so the list starts at about 27
   matching results. "More results" reads one page at a time, as before.
3. **Filters still apply on "More results".** The continuation token carries the filters. A
   recorded continuation must show this (see D2).
4. **The "already in your hub" skip, its 4-page budget, dedupe across pages, the blocklist and
   the empty and error states stay as they are.** The review found nothing wrong with them (`acceptable`, `fetchPage`, `searchScreen`).
5. **Tests:** parser tests for the new section rule against recorded fixtures (plain, sorted,
   date-filtered, and a continuation of a filtered search), plus a hub test that no heading is
   drawn.
6. **Requests:** 2 per new search (was 1), 1 per "More results". When everything is already in
   the hub, an action can read up to 4 pages, the same cap as before. The rules live in
   `collectPages` (`src/search.ts`) and are tested there.

## Decisions (Isaiah, 2026-11-12)

- **D1. What happens to the results after the first section?** **Picked: drop them and load
  page two automatically** (Claude had recommended merging them on plain searches). Options offered: **merge them into the list on a plain search, and drop them when any filter or
  sort is set.** A plain search then reads like YouTube's own app and keeps all ~19 results. A
  filtered search shows only results that match, about 7 on page one with "More results" for the
  rest.
  The alternatives are to always drop them (thin page one even on a plain search), or to always
  drop them and fetch page two automatically (one extra request per search, against the #66 budget).
- **D2. One small recording run to confirm the filters still work.** **Picked: yes.** **6 searches
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

1. Hub → Search → type `smarter every day` → Enter. One list of about 27 results with no
   "Results" or "Related to your search" heading, then a **More results** button.
2. Set **Sort by → Upload date**. The list reloads, and the newest video comes first ("2 days
   ago" before "1 month ago"). Scroll to the end. Nothing older is mixed in above anything newer,
   except for the odd promoted video.
3. Tap **More results**. The new cards are also newest-first.
4. Set **Uploaded → This week** (Sort back to Relevance). Every card says hours or days ago,
   never weeks or years.
5. Set both back to the defaults. You get the full list back with no heading.
