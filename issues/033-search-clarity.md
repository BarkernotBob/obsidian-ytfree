# 033 — A button that says Search, and a screen that looks like one

BarkernotBob, from the dev inbox: *"the search YouTube command needs to be clearer.
Right now it's too vague of a symbol, and in the search menu the UI needs an
overhaul to be more professional."*

A clarity and presentation pass. No new search capability.

## What was wrong

1. **The symbol said "YouTube" three times and "search" nowhere.** The button
   that opened the search screen was `YT_ICON` — the same glyph as the ribbon
   icon and as the hub's own tab icon. Three things in view wearing the same
   badge, and the one that navigates somewhere was indistinguishable from the
   two that do not.
2. **There was no command for it at all.** Search was reachable only from a
   button in the corner of one view. The palette — the place you go to look a
   thing up by its name — had no answer for "search".
3. **The screen never named itself.** Header, an input, four bare dropdowns.
   Nothing on it said what it was, and the input's placeholder was the only
   clue that it searched YouTube rather than filtering the hub — which is the
   very confusion [008](008-browse-round-two.md) was written to end.
4. **The dropdowns were unlabelled and unreadable.** Each showed only its
   current value, so "Any time / Any length / Any type / Relevance" was four
   words with no indication of what they governed. Nothing marked a filter that
   had been narrowed, so a search returning three results looked broken rather
   than filtered.
5. **Every state was one line of grey text.** Idle, loading, failed, nothing
   found, and "all of these are already in your hub" all rendered as a sentence
   in the status strip. The failure offered no way to try again.
6. **The two descriptions of a state disagreed.** The strip said `Nothing found
   for "x".`; the block behind it said `No results.` for the same moment. They
   were separate string literals in separate methods.
7. **The heading "Related to your search" existed; "Results" did not.** The
   primary column was unlabelled, so on a wide pane the second column looked
   like a continuation of the first.
8. **The back button was a ~22px target on a phone.**

## What it does now

- **The button is a labelled pill**: a new glyph — a search lens with a play
  triangle centred in it (`ytfree-search-youtube`, in `src/icon.ts` alongside
  the share icon [030](030-preview-transcript-share-and-moment.md) added for
  the same reason) — followed by the words **Search YouTube**. The glyph is
  there to be recognised the second time; the words are what work the first.
- **A palette command**: *YT Free: Search YouTube for new videos*. It opens the
  hub if it is closed, reveals it if it is not, and lands on the search screen
  either way.
- **The screen names itself**: the same glyph and the words "Search YouTube" in
  the header, next to a back button that is now a 32px box (44px on a phone).
- **The input is a field, not a box**: a leading lens, and an accent-coloured
  run button at the trailing edge for a phone, where there is no visible Enter
  key. Focus draws a ring with `box-shadow`, which paints outside layout.
  It stays visually distinct from the hub's own "Filter these videos" box, so
  the two continue to read as different jobs.
- **Each dropdown has a standing label** — Uploaded, Length, Type, Sort by —
  in a fixed-height caption above it, and a control set to anything but its
  default is tinted with the accent colour. Colour only, on a box that was
  already a fixed size.
- **Five drawn states**, from one function: idle explains what the screen is
  for; loading spins; failure states the reason and offers **Try again**;
  nothing-found suggests fewer words, and says "or loosen the filters above"
  only when a filter is actually set; and all-already-in-your-hub is its own
  answer rather than being reported as an empty search.
- **One source for the wording.** `searchScreen()` in `src/search-screen.ts`
  takes the state and returns the status line, the headline, the help and
  whether a retry is on offer, so the strip and the block cannot disagree
  again. It has no `obsidian` import and is unit-tested directly.
- **Both result columns are headed** — "Results" and "Related to your search" —
  each created lazily, so an empty column stays empty.
- Results are separated by an inset `box-shadow` rather than a border, and sit
  on 12px of vertical padding.

### Holding still

Every state change on this screen is colour-only or pre-reserved:

- the filter mark is a colour on a fixed-size select;
- **Try again** is always rendered and hidden with `visibility`, which keeps its
  space and takes it out of the tab order and out of hit testing;
- the help line has a reserved `min-height` and the state block a `min-height`,
  so five messages of different lengths occupy one box;
- the status strip has a fixed height and does not wrap;
- separators and the focus ring are box-shadows, which cost no layout.

`tools/search-screen-harness.mjs` measures this rather than asserting it: it
renders the screen under Obsidian's own `app.css` at 390×844 and at desktop
size, sets two filters, swaps the state block through all five messages, and
reports anything whose box moved. It found the one real defect in the first
draft — the run button at 36px, the only control on the screen under 40pt — and
now reports nothing.

### Phone

Its own layout, not a scaled-down desktop: a 48px field holding a 40px run
button, 16px on the input so iOS does not zoom on focus, dropdowns two-up at
44px (four across a 390pt screen truncates every label to its first word), a
44px back button, and the button's **Search YouTube** label kept — the word
"Search" is precisely what it was missing.

## Acceptance criteria

- [x] The control that opens search is distinguishable at a glance from the
      ribbon icon and the hub's tab icon.
- [x] The search screen is reachable from the command palette by name.
- [x] The screen states what it is without relying on a placeholder.
- [x] Every filter control is labelled, and a narrowed one is visibly marked.
- [x] Idle, loading, failed, nothing-found and already-in-your-hub each render
      as a distinct state, and only the failure offers a retry.
- [x] The status line and the state block never describe the same moment
      differently.
- [x] Setting a filter, or moving between any two states, moves nothing else on
      the screen — measured, not assumed.
- [x] On a phone every control is at least 40pt and the input does not trigger
      iOS zoom.
- [x] No new search capability: the same query, the same four filters, the same
      request.
- [x] 440 unit tests pass; `tsc` clean; build clean.

## Manual test (for BarkernotBob)

**On the Mac**

1. Open the YT Free hub. Look at the top-right: the button should read
   **Search YouTube** next to a small magnifying glass with a play triangle
   inside it. It should not be the red YouTube badge any more, and it should be
   obviously different from the YouTube icon on the ribbon and on the hub's own
   tab.
2. Open the command palette (⌘P) and type "search". **YT Free: Search YouTube
   for new videos** should appear. Run it. The hub opens on the search screen
   with the cursor already in the box.
3. The header should say **Search YouTube**, and below the box you should see
   four labelled dropdowns: Uploaded, Length, Type, Sort by.
4. Before typing anything, the middle of the screen should read "Search all of
   YouTube" with a line explaining that nothing here plays.
5. Set **Length** to "Over 20 minutes". The dropdown should change colour to
   your theme's accent. **Watch the rest of the screen while you do it —
   nothing else should move, jump or resize.** Set it back to "Any length" and
   the colour should go.
6. Search for something ordinary, e.g. `veritasium`. Above the results the
   status line should read something like "20 results for "veritasium"", and
   the first column should be headed **Results**.
7. Search for gibberish, e.g. `qwzxvplk 8817`. You should get a centred block
   reading "Nothing found for …" and "Try fewer words, or a different
   spelling."
8. Now set Uploaded to "Last hour" and search the gibberish again. The help
   line should now mention loosening the filters.
9. Turn off wi-fi and search anything. You should get "Search failed", the
   reason underneath, and a **Try again** button. Turn wi-fi back on and press
   it — the search should run.
10. Search for a channel whose videos are all already in your hub. Instead of
    "nothing found", it should say "You already have all of these".

**On the iPhone**

11. Open the hub. The **Search YouTube** button should still carry its label,
    not shrink to an icon.
12. Tap it. Tap into the search box: **the screen must not zoom in.** Type a
    search and press the blue arrow button at the right-hand end of the box.
13. Check that arrow button is comfortable to hit with a thumb — it should be a
    proper 40pt square, not a small tap target.
14. The four dropdowns should be in two rows of two, each with its label above
    it, each label fully readable rather than cut off.
15. Change one dropdown. Nothing above or below it should shift.
16. Tap the back arrow at the top-left. It should be easy to hit first time.

## Deliberately left alone

- **The card itself.** Result cards share `buildCard` with the whole hub;
  [023](023-card-controls-layout.md) settled its two-up phone layout, and
  `tools/phone-hub-harness.mjs` measures it. Only `.ytfree-hub-result` spacing
  and the separators between cards were touched.
- **The hub's own "Filter these videos" box**, which stays visually distinct on
  purpose.
- **Search itself** — query handling, the four filters, the InnerTube request,
  paging, and which results are skipped as already-in-hub are all unchanged.
