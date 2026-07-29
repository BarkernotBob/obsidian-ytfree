# 007 — Browse: search YouTube from inside the hub

**Status:** Built 2026-07-28 — awaiting manual test.
**Created:** 2026-07-28
**Scope:** [docs/V1-SCOPE-BROWSE.md](../docs/V1-SCOPE-BROWSE.md) (gate passed before build)

## The short version

A search box at the top of the hub. Type, press Enter, get results rendered as the hub's
own cards — no ads, no recommendation shelves, no autoplay, and **nothing playable**. One
click adds a result to the hub as an ordinary item; the hub decides what happens next.

Search is `POST youtubei/v1/search` with the ANDROID client context, signed out, and the
results are drawn by us. That is the whole reason the surface is clean: the parser reads
one renderer (`compactVideoRenderer`) out of the item sections and refuses everything else
in the response, including the ads and shelves that are demonstrably in there.

## What was built

- `src/search.ts` — the parser. Pure, fixture-tested, never throws; a broken or unfamiliar
  response degrades to "No results".
- `src/innertube.ts` + `src/innertube-context.ts` — the requests, and the client identities
  they are made as. The player resolver now shares them instead of carrying its own copy.
- `src/hub.ts` — the search row, search mode, result cards, "More results", and
  `addSearchResult` (which fetches the description with one player call before storing).
- `src/subscriptions.ts` — `origin: "search"`, `searchResultToItem`, and the expiry
  exemption.
- `spikes/search/` — the recorder behind the two fixtures, and what the response actually
  contains.

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

Covered automatically: 7 and 9 in `tests/subscriptions.test.ts` and `tests/search.test.ts`;
the live shape of the response in `npm run smoke`. The rest are the manual test below.

## Manual test (for BarkernotBob)

Desktop first. If the plugin was already open, quit Obsidian and reopen it — a reload alone
sometimes keeps the old code.

1. Open the command palette and run **YT Free: Open subscriptions hub**. There is now a
   search box under the filter row, reading "Search YouTube".
2. Type `smarter every day` and press Enter. Within a couple of seconds the list is
   replaced by search results, and the line above it says how many there are.
3. Look at one result. It should show a thumbnail, a title, and a line reading
   *channel · how long ago · views* — with the **duration in the bottom-right corner of the
   thumbnail**. (Hub items from a channel feed have no duration; results do.)
4. Scroll the whole list. There should be **no ads, no "people also watched" strip, and no
   video that starts playing** when the pointer passes over it.
5. Click a result — anywhere on the card. The marker at the right (on the phone: the badge
   on the thumbnail) spins briefly, then becomes a tick. **Watch the rest of the card and
   its neighbours while it happens: nothing may move, resize or shift.**
6. Click that same result again. Nothing should happen — no second spinner, no duplicate.
7. Scroll to the bottom and click **More results**. More cards are appended below; the ones
   you were reading stay exactly where they were.
8. Set the filter to **All**, then clear the search box (delete the text, or use the little
   × in it). The hub comes back — still on **All**, still on whatever channel you had
   selected.
9. Find the video you added. It is in the list, tagged **Search**, with no age next to it —
   search tells us "2 days ago", never a date, so no date is invented. Click it: a Watch
   Later note is created and the player pins, exactly like a feed item.
10. Look at the note's **## Description** section. The real description should be there — it
    was fetched when you added the video, not when you clicked it.
11. Search for something that certainly does not exist, e.g. `qwzxvplk nonexistent 8817`.
    You may get loose matches or nothing; either way the plugin must not show an error
    dialog or a blank screen. "No results." is a valid answer.
12. Turn Wi-Fi off and press Enter on a new search. The list should read
    *Search failed — …* and stay usable. Turn Wi-Fi back on and search again; it recovers.

Now the phone (same vault, after iCloud has synced the plugin — force a download if it
looks stale):

13. Open the hub, tap the search box. The keyboard opens and **the page must not zoom in**.
14. Search, and check the results are one card per row with the duration on the thumbnail
    and no sideways scrolling.
15. Tap a result. The badge on the thumbnail becomes a tick, and the row does not move.
16. Clear the box; the hub returns with your filter intact.

## Known limitations (accepted for v1)

- No channel pages, no playlists, no filters, no autocomplete — all v2, see the scope doc.
- A search-added item sorts with the undated items (the bottom of the list), exactly as a
  Watch Later item does, because search never states a publish date.
- No Shorts detection on results. A Short added from search shows up as an ordinary item
  until a desktop poll probes it.
