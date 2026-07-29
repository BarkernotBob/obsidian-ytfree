# 008 — Browse, round two: filters, two search bars, and a hidden list

**Status:** Built 2026-07-28 — awaiting manual test.
**Follows:** [007](007-browse-search.md) ([docs/V1-SCOPE-BROWSE.md](../docs/V1-SCOPE-BROWSE.md))

Four asks, one change set, because they overlap: two of them are about what the
search box *is*, and two are about which videos a list is allowed to show.

## v1 scope

The smallest version that is worth having:

1. **YouTube's own search filters.** Upload date, duration, sort, and one
   feature toggle — sent to YouTube as its own `params` protobuf, so the
   filtering happens at YouTube and not in a page of twenty results we already
   fetched.
2. **A search never offers a video you have already dealt with.** Anything in
   the hub — saved, kept, or hidden — is dropped from the results before they
   are drawn.
3. **A Hidden list in the hub**, so removing a video is reversible. Hidden items
   are kept as thin tombstones: no description, no thumbnail, no image request
   when the list is drawn.
4. **Two search boxes, two jobs.** The box in the hub filters the list you are
   looking at. Searching YouTube is its own screen, reached from a button.

Out of v1, and a v2 ticket if it is ever wanted: multi-select features, channel
and playlist results, search suggestions/autocomplete, a per-channel search, and
anything that syncs the hidden list between devices beyond the vault file that
already syncs.

## Why the parts are the way they are

### 1. Filters

YouTube's filter panel is not a set of query arguments. It is one opaque
`params` string on the search request, and that string is a base64url protobuf.
`spikes/search-filters/` encodes it ourselves and measures what comes back —
asserting on the *content* of the results, because a wrong `params` is ignored
rather than rejected, so "it returned results" is precisely the failure to guard
against.

Measured 2026-07-28 against the live ANDROID client:

| Filter | Result |
|---|---|
| Duration over 20 min | every result over 20:00 |
| Duration under 4 min | every result under 4:00 |
| Uploaded this week | nothing older than a week |
| Type = video | playlist and channel renderers gone from the response |
| Features = live | 20/20 entries with no duration, i.e. streams |
| Two filters at once | both applied |
| **Sort** | **changes the result set, but the order is not clean — see below** |

Sort works, with a caveat worth stating rather than hiding. YouTube injects a
couple of fresh, low-view videos into a view-count-sorted list — measured, 2 of
20 — and they are **structurally identical** to real results: same renderer,
same fields, no badge, nothing to filter on. That is a promotion, and it is the
same class of thing as the recommendation shelves the parser already refuses,
except that this one is indistinguishable. So sort ships as *YouTube's* sort and
the limitation is documented, not papered over.

The other half of the disorder is ours and is fixable: the response holds
several item sections, and only the first is the answer to the query. The rest
are "related to your search" material that no sort and no filter touches.
`src/search.ts` flattens all of them today, which is why a sorted list looked
random. Results now carry which section they came from, and the hub draws the
related ones under their own heading, below the answer.

Type is pinned to `video` on every search from now on. The parser only
understands videos, so this removes the channel and playlist entries from the
response instead of from our reading of it.

### 2. Hiding what you have already dealt with

`hasItem` already knows. The filtering happens when a page lands rather than
when a card is drawn, so no card is ever removed from under the pointer — and a
video added *in this session* deliberately stays on screen with its tick, which
is the whole no-reflow rule from 007.

If a whole page is filtered away, the next one is fetched automatically, up to
three pages, so an empty screen is never the answer to a search that had results.

### 3. The hidden list

Removing a video currently deletes it: `expireItems` drops Dismissed items on
the next poll, so there is nothing to show and no way back. Now a removal leaves
a tombstone.

The tombstone is the storage answer. On dismiss the item is **compacted** — the
description is dropped, which is the only field with real size in it, and the
thumbnail URL with it. What remains is roughly 150 bytes: id, title, channel,
and when you hid it. The Hidden list draws as text rows with no `<img>`, so
opening it costs no image fetches and no image cache.

Nothing is lost that cannot be recovered: a thumbnail URL is derivable from the
video ID, and restoring an item re-fetches its description with the one player
call a search-add already makes.

The list is capped at 500, oldest first. At ~150 bytes that is 75 KB, and a
tombstone that falls off the end just means the video may be offered again.

### 4. Two search boxes

The hub's box now filters the hub — instant, local, over title and channel — and
does not touch the network. Searching YouTube is a separate screen behind a
button in the header, with its own box, its own filters and its own results.

They were the same control and should not have been: one is "narrow what I am
looking at", the other is "go and get something new". The filter box being local
also means it works on the Hidden list, which is where you will actually need it.

## Acceptance criteria

**Filters**

1. The browse screen offers Upload date, Duration, Sort by and Features, and
   changing any of them re-runs the current search.
2. A duration filter of "Over 20 minutes" returns only videos over 20 minutes.
3. An upload-date filter of "This week" returns nothing older than a week.
4. Filters survive "More results" — page two is filtered like page one.
5. Filters are remembered for as long as the hub view is open — including a trip
   back to the hub and back again — and reset when the view itself is closed.
   They are not saved to disk: a filter is a setting for the search you are
   doing, not a preference.
6. Results from the response's secondary sections are drawn under a "Related to
   your search" heading, never mixed into the answer.

**Already-dealt-with videos**

7. A video already in the hub — New, Kept or Hidden — never appears in search
   results.
8. A video added during this session stays on screen with its tick; nothing
   moves.
9. A search whose first page is entirely filtered away fetches the next page
   rather than showing "No results".

**Hidden**

10. Removing a video from the hub puts it in Hidden and it stays there across a
    poll, a restart, and an expiry run.
11. The Hidden list draws no thumbnails and issues no image requests.
12. A hidden item stores no description.
13. Restoring a hidden item returns it to New and re-fetches its description.
14. The hidden list never exceeds 500 items; the oldest fall off first.

**Two boxes**

15. Typing in the hub's box filters the visible list as you type, matching title
    or channel, and makes no network request.
16. The hub's filter box applies to whichever list is shown, Hidden included.
17. The YouTube search screen is reached from the header, has its own box, and
    returning to the hub restores the hub exactly — filter, channel and local
    filter text intact.
18. On a phone, both boxes take focus without the view zooming.

Covered automatically: 2–6 in `tests/search-params.test.ts` and
`tests/search.test.ts`; 10, 12, 14 in `tests/subscriptions.test.ts`; 15 in
`tests/subscriptions.test.ts` via `hubItemMatches`; the live behaviour of the
filters in `spikes/search-filters/probe.mjs` and `npm run smoke`.

## Manual test (for BarkernotBob)

About ten minutes on the desktop, five more on the iPhone. Open the hub first:
command palette → **YT Free: Open subscriptions hub**.

**A. The hub's box filters the hub, and nothing else**

1. In the hub, type a word you know is in one of your video titles into the box
   at the top (it says *Filter these videos*).
2. The list should narrow **as you type**, with no spinner and no pause. The
   status line under the box says how many matched.
3. Type a word that is in a channel name instead. It should match those videos
   too.
4. Type two words that are in different places — say half a title and half a
   channel name. Both have to match for a video to show.
5. Press **Escape**. The box empties and the full list comes back.

**B. Searching YouTube is its own screen**

6. Click the **YouTube icon** in the top right of the hub. You get a new screen
   titled *Search YouTube* with a back arrow, a search box, and four dropdowns.
7. Type something with a lot of results — `obsidian` — and press **Enter**.
8. Results appear as cards. Clicking one **adds it to your hub** and the card
   grows a tick. It must not start playing anything.
9. Watch the card you just clicked: it should stay exactly where it is, and
   nothing above or below it should shift.
10. Click the **back arrow**. You are in the hub again, with the same filter, the
    same channel selected, and whatever you had typed in the hub's box still
    there.
11. Click the YouTube icon again. Your search and its results are still there.

**C. The filters are YouTube's filters**

12. On the search screen, search `music` with **Duration → Over 20 minutes**.
    Check the little duration badge on the bottom-right of each thumbnail:
    **every one** must read 20:00 or more. If a single result is under, that is a
    failure worth reporting.
13. Scroll down and click **More results**. The new cards must obey the same
    rule — the second page is filtered like the first.
14. Set **Upload date → This week**. Every result should say "x days ago" or
    newer, none in months or years.
15. Set **Type → Live**. The results should be streams — no duration badge.
16. Change any dropdown while a search is on screen. It should re-run by itself;
    you should not have to press Enter again.
17. If results appear under a **Related to your search** heading, that is
    correct — that is YouTube's own related material, kept out of the answer.
    Expect the odd oddly-fresh video in a view-count sort; see *Known
    limitations*, it is YouTube promoting it and there is no way to tell.

**D. Nothing you have already dealt with comes back**

18. Note the title of a video you just added in step 8. Search for that exact
    title on the search screen.
19. It must **not** appear in the results. The status line should mention how
    many were "already in your hub, not shown".

**E. Hidden, and the way back**

20. Back in the hub, remove a video with the **×** on its card. It greys out and
    goes, as before.
21. Click the **Hidden** chip at the top. The video you just removed is there, as
    a **line of text** — title, channel, and how long ago you hid it. There are
    deliberately no thumbnails on this list.
22. Type into the hub's filter box while Hidden is showing. It filters this list
    too.
23. Click the **↺ arrow** on a hidden row. The row goes. Click **New** — the
    video is back in your list, thumbnail and all.
24. Hide another video, then quit Obsidian completely and reopen it. Open the hub
    → **Hidden**. It is still there. (Before this change, removals vanished for
    good on the next sync.)
25. Run **YT Free: Check subscriptions for new videos** from the palette, then look at
    Hidden again. Still there.

**F. On the iPhone**

26. Open the hub on the phone. Tap the filter box — the view must **not zoom in**
    when the keyboard appears.
27. Tap the YouTube icon, then tap the search box and each of the four dropdowns
    in turn. No zoom, and each dropdown opens as a proper iOS picker. The four
    sit as two rows of two and must not move when you choose something.
28. Tap the menu control at the top of the hub and check **Hidden** is one of the
    four chips. Choosing it closes the menu and shows the list.

Report anything that moves, jumps or resizes when you tap it — that is the rule
this whole plugin is held to, and it is the failure most worth knowing about.

## Known limitations (accepted for v1)

- **Sort is YouTube's sort.** A view-count-sorted list will contain the odd
  fresh, low-view video that YouTube chose to promote. It is not distinguishable
  from a real result by any field on the response — measured, see above.
- One feature at a time (Live *or* 4K *or* Subtitles), not YouTube's checkbox
  set. The single control is what keeps the filter bar from reflowing.
- Restoring a hidden item re-fetches its description from the player. If the
  video has since gone private, the restored item has no description — the copy
  captured at poll time was dropped when it was hidden.
- No autocomplete, no channel pages, no playlists. Still v2.
