# spike: InnerTube search

What `docs/V1-SCOPE-BROWSE.md` is built on. `POST youtubei/v1/search` with the
ANDROID client context answers **with no auth and no API key** — the same
surface the mobile player resolver already depends on, so browse costs the
plugin no new relationship with YouTube.

`record.mjs` captures two responses into `tests/fixtures/` and trims them; run
it when the fixtures start looking stale. The diff is the interesting part.

```
node spikes/search/record.mjs
```

## What the response actually contains (measured 2026-07-28)

- Results are `compactVideoRenderer` entries inside
  `contents.sectionListRenderer.contents[].itemSectionRenderer.contents[]`, and
  carry id, title, channel, channel ID, relative publish time, view count and —
  unlike a channel feed — **duration**.
- Paging is `contents.sectionListRenderer.continuations[0].nextContinuationData`.
  A continuation answers in a different envelope:
  `continuationContents.sectionListContinuation`, same contents shape.
- **Ads are in the payload.** The scope doc's first measurement said otherwise;
  it was wrong. They arrive as `elementRenderer` entries (`adSlotLoggingData`,
  `aboutThisAdRenderer` in the untrimmed capture), not as `compactVideoRenderer`.
  So the ad-free result still holds by construction — the parser reads one
  renderer and refuses everything else — but it holds because of the parser, not
  because the response is clean.
- Recommendation shelves are `horizontalCardListRenderer` full of
  `videoCardRenderer`. Also refused, and the reason the parser walks
  `itemSectionRenderer.contents` directly rather than searching the tree for
  video IDs.
- No description: `descriptionSnippet` is absent on ANDROID. The hub fetches it
  from `youtubei/v1/player` at add time.
- No publish *date*, only "2 days ago", and the ANDROID player response carries
  no `microformat` either — so a search-added item has no ISO date anywhere.
