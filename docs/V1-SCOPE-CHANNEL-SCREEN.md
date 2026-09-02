# V1 scope — the channel screen

**Written:** 2026-09-01, ahead of [issue 045](../issues/045-channel-screen-and-subscribe.md).
Per the repo rule: the smallest version that is worth having. Everything below
the line is a v2 ticket, not a stretch goal.

## The one sentence

**From any video, get to that channel's back catalogue, search inside it, and
save what you find into the hub the same way search already does.**

## Why this is worth building at all

Today the plugin can only ever show you the last 15 videos of a channel you are
already subscribed to. There is no way, from inside Obsidian, to answer "what
else has this person made?" — which is the question you ask immediately after
watching something good. The alternative is opening youtube.com, which is
precisely the thing this plugin exists to avoid: the sidebar, the
recommendations, the autoplay.

Two smaller things fall out of it for free, and both were asked for:
subscribing to a channel you found this way, and the backfill that
[048](../issues/048-rss-backfill.md) needs.

## In scope

1. **A channel screen**, reached from a video note, a hub card and a preview.
2. **That channel's uploads, oldest-to-newest paging** — InnerTube `browse` with
   a continuation token, not the 15-entry RSS feed.
3. **A search box over that channel's catalogue.**
4. **The same four card actions the hub and search already have** (Save,
   Preview, Hide, Watch), through the same `buildCard`. No new card definition.
5. **Subscribe**, which opens the channel on youtube.com in the external
   browser. Desktop only.
6. **Channel facts at the top**: name, avatar, subscriber count, video count.

## Out of scope for v1 — these are the v2 tickets

- **Subscribing from inside the plugin without a browser round-trip.** It needs
  an authenticated write, which is a different risk class from every read this
  plugin does. Opening the browser is the honest version and account sync picks
  the channel up on the next pass.
- **A channel's tabs other than uploads** — playlists, shorts, live, community,
  about. Uploads is the question being asked.
- **Sort orders** other than YouTube's default (newest first). Popular-first is
  the obvious second, and it is a v2.
- **A followed-but-not-subscribed state.** A channel is either in
  `subscriptions.json` or it is not; no third thing.
- **Caching the catalogue to disk.** The screen is live and re-fetches. A
  channel's uploads page is not something to keep a stale copy of, and
  `subscriptions.json` is already the file that syncs on every write.
- **Anything that changes what the RSS poll does.** The backfill is
  [048](../issues/048-rss-backfill.md) and depends on this, but is not this.

## The stranger test

A stranger who installed this today, watched one video from one subscribed
channel, and thought "that was good" can now see everything else that channel
has made, search it by title, and save three of them into their hub — without
opening YouTube. That is the whole of v1 and it is worth having on its own.

## What we already have, so this is smaller than it looks

- `callInnertube` and the continuation call shape exist
  ([innertube.ts:87](../src/innertube.ts)) — `searchYouTube` already pages with
  a token, and a channel browse is the same call with `browseId` instead of
  `query`.
- `parseSearchResponse` ([search.ts:182](../src/search.ts)) already turns
  InnerTube's renderer soup into `SearchResult[]`; a channel's uploads grid uses
  the same renderers.
- `buildCard` takes facts, not objects, and has never heard of `HubItem` or
  `SearchResult` — a third surface is what it was built for
  ([hub.ts](../src/hub.ts)).
- The search screen's five drawn states (idle, searching, failed, nothing found,
  all already saved) are worded in `search-screen.ts` and apply here unchanged.

The genuinely new part is one InnerTube call shape, one screen, and the
navigation into it.
