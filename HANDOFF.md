# HANDOFF

## Status — 2026-07-29 (latest): resume, phone transcripts, a row you can hit

Built and installed. 211 unit tests pass, build clean, live smoke 10/10.
[issues/012](issues/012-resume-transcript-and-controls.md) is the issue and holds
the manual test. Five asks from BarkernotBob.

1. **The phone byline moved under the picture.** It had ~150pt in the title
   column — card width minus a 112px thumbnail minus a 112px dismiss target —
   and the age was what got cut. Full content width now (**269pt, measured**),
   thumbnail down to 112×63, card 92px → **100px**, still seven a screen. Two
   spans, not one string: `.ytfree-hub-sub-age` never ellipsizes,
   `.ytfree-hub-sub-name` is the only thing that may. `phoneSub()` is now a
   wrapper over the new `phoneSubParts()`. **Bug found on the way:** result cards
   inherited the hub card's two-column grid and laid out against a dismiss track
   they never have — single-track now, byline 269pt → 372pt, and this was
   probably the clipping BarkernotBob was actually seeing.
2. **Scroll room past the last card**: `88px + env(safe-area-inset-bottom)` of
   bottom padding on the phone list, so Obsidian's floating toolbar stops
   covering the last video.
3. **Playback position is remembered** — new `src/progress.ts` (rules, pure,
   13 tests) and `src/progress-store.ts` (`progress.json` beside
   `subscriptions.json`, 4s debounce, flushed on unload). Keyed by **video**, not
   note. Under 15s is not worth remembering; within max(20s, 3%) of the end
   **clears** the entry, so a finished video reopens at 0:00. Reported every 5s
   while playing and immediately on pause/seek/end/teardown — iOS can kill the
   process without warning. Surfaced both ways: desktop flashes *"Picking up at
   12:34"* in the status row it already reserves, the phone puts a
   **`Resume 12:34`** badge on the poster. Deliberately **not** frontmatter — it
   would rewrite a synced file every few seconds and edit under a live cursor.
4. **Transcripts work on the phone.** BarkernotBob's premise was right:
   `queueAutoFetch` returned early on mobile because the fetch shelled out to
   yt-dlp. The phone reads `captionTracks` off the ANDROID player response and
   forces `fmt=json3` — provable because the signature covers `sparams`, which
   excludes `fmt` (`pickPlayerCaptionTrack`, 6 unit tests + a live smoke test).
   **Most-replayed stays desktop-only**: the heatmap exists only in yt-dlp's info
   JSON, and InnerTube's `next` endpoint is 10.5 MB with no `heatMarker`.
   Re-running the command on the Mac fills it in.
5. **The control row.** The "10" badges were corner-tucked, so a symmetrical
   pair had its two numerals 40px apart on the outside edges — centred now, with
   the chevrons shifted up 4px. Spacing was one flat 6px between all nine
   targets; the between-group gap is now double the in-group gap, and the phone
   **stops shrinking its buttons** (36pt/4pt → **40pt/8pt**), paid for out of the
   speed picker. New `tools/controls-harness.mjs` measures it at 375/390/430/700:
   `overflow: 0, smallestTarget: 40, smallestGap: 8, playOffCentre: 0,
   badgeOffCentre: [0, 0]` at every width.

`tools/phone-hub-harness.mjs` now renders a result card too and reports byline
width and per-card clipping: `{cardHeight: 100, fullyVisible: 7, heights: [100],
bylineWidth: 269, agesClipped: 0, channelsClipped: 0, durationsClipped: 0,
resultHeights: [100], resultBylineWidth: 372, tailRoom: 88}`.

**Next:** the manual test in issues/012 on the phone. Steps 5–7 (resume) and 8
(a phone-made note gets a transcript) are the two that decide it.

---

## Status — 2026-07-29: no blurb, a bigger ×, lists that say what they are

Built and installed. 192 unit tests pass, build clean.
[issues/011](issues/011-card-trim-and-filter-names.md) is the issue and holds the
manual test. Three asks from BarkernotBob, all phone, all in the hub — and two of them
undo parts of 010, which is the point: 010 guessed what a card should carry.

1. **The description is off the card.** A YouTube description is written to sell
   the video; `cardBlurb` could drop the chapter list and the link farm but not
   the marketing, so three lines of it was three lines of a channel talking about
   itself. Card is 92px again, ~7 to a screen. The 128×72 thumbnail, the length
   badge and a readable title — the parts of 010 that worked — stay.
   `cardBlurb()` is deleted, not left unused.
2. **The × column is 112px, doubled.** That width comes out of the title, and it
   was measured against **200 real titles from the live hub**, not eyeballed:
   56px → 24% of titles cut off, 112px → 58%. Not acceptable, and the fix was
   already lying around — the row is as tall as the 72px thumbnail and a two-line
   title plus byline used 49 of it. **The phone title takes three lines now**,
   which puts cut-off back to **25%**. If it still reads clipped, 80px is the
   next number to try (163px title, 14% cut off).
3. **New/All are Inbox · Kept · Hidden · Everything.** BarkernotBob's read was correct
   — New *is* "everything not kept and not hidden" — and All differed by two
   clauses nothing on screen could show: it also holds Kept items, and it shows
   ones YouTube says you already watched. So the first three chips are the three
   states a video can be in, Everything is named as the union it is, and the
   **status line now states the current list's rule** in place of `42 of 264
   videos` (`221 videos · not opened, not hidden`). Same sentence as a desktop
   tooltip. `FILTER_LABELS`/`FILTER_RULES` in `src/hub.ts` are the one place to
   edit any of this.

**Everything was kept, not deleted**, against the "one menu would do" reading:
it is the only list where an already-watched video appears and the only place one
search covers kept and undecided at once. Four lines to remove if neither lands.

`tools/phone-hub-harness.mjs` reports `titleWidth`/`titleLines`/`titleClipped`
and `dismissWidth` now instead of the description numbers. Measured after the
change: `{cardHeight: 92, fullyVisible: 7, heights: [92], titleWidth: 131,
titleLines: 3, dismissWidth: 112, dismissFullHeight: true, overflows: false}`.

**Next:** the manual test in issues/011 on the phone. Step 2 (long titles still
read) and step 7 (Inbox vs Everything is now obvious) are the two that decide it.

---

## Status — 2026-07-29: hub cards, a designed control bar, note sections

Built and installed. 194 unit tests pass, build clean.
[issues/010](issues/010-cards-controls-sections.md) is the issue and holds the
manual test. Seven asks from BarkernotBob, one change set.

1. **Four cards a screen, not seven.** The phone card is a 148px grid — thumb +
   title + `channel · age` on row one, three clamped lines of description on row
   two, delete column spanning both. Measured with the new
   `tools/phone-hub-harness.mjs` at 390×844: **4 fully visible, a 5th partly,
   every card exactly 148px**. Video length is the badge on the thumbnail, and it
   is the one fact that needed new data — **a channel RSS feed carries no
   duration**, so `HubItem.durationSeconds` is backfilled from the InnerTube
   player endpoint at poll time (newest first, 40/poll, 4 at a time;
   `undefined` = never asked, `null` = asked and refused). The card blurb is
   `cardBlurb()`, not the raw description: bare-URL, chapter-stamp and
   hashtag-only lines dropped, cut on a word boundary at 220 chars.
2. **The control bar was rendering as Obsidian's default buttons and nobody
   could see it from the source.** `button:not(.clickable-icon)` is (0,1,1) and
   beats any single-class rule — grey slabs, inset highlight, drop shadow, and
   an accent Play that came out a dark circle. The old code only won because it
   happened to use a two-class selector. Every button rule is scoped now
   (`.ytfree-controls .ytfree-btn`, `.ytfree-sections .ytfree-section-link`,
   `.ytfree-hub .ytfree-hub-icon-button` — the hub had been losing silently in
   shipped builds). **Found by screenshotting the headless render, not by
   reading.**
3. **The bar overflowed every current iPhone.** The compact step was gated at
   `max-width: 380px`; 390/393/402/430 all got the 40px sizes and ran off the
   edge. Breakpoint is 460px. Re-measured: no overflow at 375/390/430/900, Play
   within 1px of centre except the 375pt SE (8px left).
4. **One design on both platforms** — `1fr auto 1fr`, transport centred, 40px
   flat squares, Play 48px round in the accent. Desktop's left-packed row of
   seven differently-sized word buttons is gone.
5. **Notes · Description · Transcript**, a second row of three equal pills that
   jump to the note's headings. The jump unfolds *that* section only; Notes also
   parks the cursor (the other two deliberately don't — a cursor in the
   transcript sends your next keystroke into someone else's words).
6. **Headings are level 1, "Video Description" / "Video Transcript", two blank
   lines under Notes, and a note opens with everything but Notes folded**
   (`applyDefaultFolds`, once per file per view, like `collapseProperties`; off
   via **Collapse description and transcript**).

**Nothing rewrites an existing note.** ~50 notes carry `## Notes` /
`## Description` / `## Transcript`; `src/sections.ts` is now the single source
of truth for headings and every lookup accepts the old spellings, so buttons,
folds and transcript re-fetch all work on them unrewritten. The opt-in half is
the command **"Rename this note's sections…"**, one note at a time.

Fold control uses undocumented internals — `currentMode.getFoldInfo/
applyFoldInfo/applyScroll` and `app.foldManager.save` — each in its own
try/catch. If a future Obsidian renames one, folds stop working; nothing throws.

**Also edited, and they live in the vault repo, not this one:**
`Templates/8.Watch_Later_Template.md` and `System Templates/Obsidian Clipper -
Watch Later (YT Free).json`. Re-import the clipper JSON before testing item E.

**Next:** the manual test in issues/010, phone half first. Section A step 1 (four
cards) and section D step 16 (opens folded) are the two that decide it.

---

## Status — 2026-07-28: mobile polish — space, tap states, controls, rows

Built and installed. 179 unit tests pass, build clean.
[issues/009](issues/009-mobile-polish.md) is the issue and holds the manual
test. Four asks from BarkernotBob, all phone-only, one change set.

1. **62px of dead screen around the video, from three separate causes.** The
   status line was a reserved row above the picture and is now an overlay across
   the top of the media box. `padding: … var(--file-margins) …` is a *four*-value
   shorthand because `--file-margins` is a pair, so the control row computed
   `6px 8px 24px 0px` — flush left, 24px of nothing underneath; `--file-margins-x`
   is the single value that was wanted. And `--view-top-spacing-markdown` is
   header + 16px, where the 16px is the gap before a note's *text* — subtracted,
   107px → 91px.
2. **The grey that followed your thumb was a hover state.** iOS applies `:hover`
   on tap and leaves it. Every hover rule is now behind
   `@media (hover: hover) and (pointer: fine)`. Phone hub rows also got full-bleed
   hairlines so the dismiss column's divider has something to meet, and the column
   is `align-self: stretch` at 56px.
3. **The control row is symbols on a `1fr auto 1fr` grid** — 40px squares, Play
   48px round in the accent colour, transport centred on the screen (verified at
   360/375/390pt). PiP sits on the left because three right-hand buttons blow past
   the `1fr` track's min-content floor and push the transport off centre.
   `paint()` falls back to the old word if `setIcon` leaves the button empty.
4. **A phone row's second line is `channel · age`,** down from seven segments.
   Short, Watched, Kept and origin are *shown* (badges, dimming) rather than
   written; views are dropped. `deskSub`/`phoneSub` in `src/subscriptions.ts`,
   both pure, both tested. Desktop line unchanged.

**Desktop is affected in exactly one place:** the `--file-margins` fix also
applies to `.ytfree-pinned`, so the pinned player's edges now line up with the
note text and the empty strip under its buttons is gone. That is a correctness
fix, not a redesign, but it is a visible change.

Measured with the phone-CSS harness (Obsidian's own `app.css` extracted from
`obsidian.asar`, hand-built phone DOM, headless Chromium), not by eye.

**Next:** manual test on the iPhone — force-download the vault and fully
relaunch Obsidian first, then walk sections A–E of issues/009.

---

## Status — 2026-07-28: browse round two — filters, Hidden, two boxes

Built and installed. 176 unit tests pass, build clean.
[issues/008](issues/008-browse-round-two.md) is the issue and holds the manual
test. Four asks from BarkernotBob, one change set.

1. **YouTube's filters are YouTube's, sent as its own protobuf.** The filter
   panel is one opaque base64url `params` field, so `src/search-params.ts`
   encodes it: upload date, duration, sort and one feature, with type pinned to
   `video` on every search. It is pure and has no `obsidian` import, so
   `spikes/search-filters/` sends exactly what the plugin sends — which mattered,
   because **a wrong `params` is ignored rather than rejected**, so the only
   proof is asserting on the content of the results. Measured live: duration,
   upload date, type and the feature bools all apply, and **filters survive
   paging on the continuation token alone**.
2. **Sort looked random and half of it was our bug.** A search response holds
   *several* item sections and only the first is the answer; the rest are
   "related to your search" and no sort touches them. `src/search.ts` was
   flattening all of them. Results now carry `secondary`, and the related ones
   draw under their own heading below the answer. The other half is not ours:
   YouTube injects a couple of promoted videos into the sorted section and they
   are **structurally identical** to real results — same renderer, same fields,
   no badge. Measured, documented in the issue, not papered over.
3. **A removal is now a tombstone, not a delete.** `expireItems` used to drop
   Dismissed items on the next poll, so there was no way back. `hideItem`
   compacts instead: description and thumbnail dropped (~150 bytes left), and the
   Hidden list draws as text rows with no `<img>`, so opening it costs no image
   fetches. Nothing is lost that cannot be recovered — a thumbnail URL is
   derivable from the ID and `restore()` re-fetches the description with the one
   player call an add already makes. Capped at 500, oldest hidden first.
4. **Two boxes, two jobs.** The hub's box filters the list in front of you —
   instant, local, title and channel, no network — and works on the Hidden list,
   which is where it is actually needed. Searching YouTube is its own screen
   behind the header's YouTube button, with its own box, filters and results;
   coming back restores the hub exactly.
5. **Search never offers a video you have already dealt with.** Filtering happens
   when a page *lands*, not when a card is drawn, so a result added while you are
   looking at it stays put with its tick — the no-reflow rule from 007. If a
   whole page is filtered away the next is fetched automatically, up to four.

### Next step

The manual test in
[issues/008](issues/008-browse-round-two.md#manual-test-for-barkernotbob), desktop then
phone. Section C step 12 is the one that decides whether the protobuf is right;
section E step 24 (hidden survives a restart) is the one that decides whether the
tombstone is. Not visually reviewed — offered, not run.

## Status — 2026-07-28: browse — search YouTube from inside the hub

Built and installed. 159 unit tests pass, build clean, and all 9 live smoke tests
pass including two new ones. [issues/007](issues/007-browse-search.md) is the
issue; [docs/V1-SCOPE-BROWSE.md](docs/V1-SCOPE-BROWSE.md) is the scope it was
built against, gate passed before any code.

1. **Search is an API call we render, not YouTube's page in a frame.**
   `POST youtubei/v1/search`, ANDROID client, signed out, no API key —
   `src/search.ts` parses the result. It reads exactly one renderer
   (`compactVideoRenderer`, out of the item sections) and refuses everything else
   by never looking at it, which is what makes the surface ad-free and
   shelf-free. Fixture-tested against two real captures; nothing in it throws.
2. **The scope doc was wrong about ads and is now corrected.** Ads *are* in the
   payload — as `elementRenderer`, not as `promoted*`/`adSlot*` renderers, which
   is what the pre-build census looked for. Recommendation shelves are
   `horizontalCardListRenderer` full of `videoCardRenderer`. The result is still
   clean, but because of the parser, so `tests/search.test.ts` pulls the shelf
   video IDs out of the fixture and asserts none of them reach the results.
3. **A result can do exactly one thing: add itself.** No anchor, no `<video>`,
   nothing a click turns into playback. Clicking adds a `HubItem` with
   `origin: "search"`, fetching the description first with one player call
   (search carries none, and the hub's premise is a description cached before it
   can go stale). Already in the hub → the marker says so and the click is a
   no-op. Search items never expire.
4. **No publish date is invented.** Search states "2 days ago" and the ANDROID
   player response has no `microformat`, so `published` stays empty: the hub
   shows no age, the card says **Search**, and the item sorts with the undated
   tail exactly as a Watch Later item does.
5. **The client identities are now shared.** `src/innertube-context.ts` (pure —
   no `obsidian` import, so the smoke test can send the same request) and
   `src/innertube.ts` (the POST, search, description fetch). The mobile resolver
   dropped its private copy and calls through them.
6. **`npm run smoke` had been dead on this Node version** — `resolver.ts`
   imported two types as values, and type-stripping made the whole module fail to
   load. One `import type` fixed it; that is how the two new live tests could run
   at all.

### Next step

The manual test in [issues/007](issues/007-browse-search.md#manual-test-for-barkernotbob),
desktop then phone. Step 5 is the one that decides the design: the marker has to
change with nothing around it moving. Not visually reviewed — offered, not run.

## Status — 2026-07-28: collapse replaces close, lazy controls, LP timestamps

Built and installed. 140 tests pass, build clean. Manual steps 25–29 in
[docs/MOBILE-UX.md](docs/MOBILE-UX.md).

1. **Close → Collapse, and it no longer tears the player down.** The old Close
   unmounted the player and left a "Show video" bar, which lost the position
   every time. Collapsing now only takes the height off the media box; the
   `<video>` stays mounted and clipped (not `display: none` — that stops
   playback on iOS), so position, buffer and audio all survive. Collapsing by
   hand also pauses; the same button reads "Show video" and brings it back.
   `dismissed`, `reopened` and `syncReopenBar` are gone with it — one state
   instead of two.
2. **The keyboard collapses the video, and only the keyboard un-collapses it.**
   Editor focus folds the player *and* the control row (that row wraps to three
   thumb-height lines — 114px, the space the fold was meant to give back).
   Measured on a 390×844 phone: note body 335px → 718px. No pause is issued, so
   pause-while-typing and its idle resume keep working underneath: audio comes
   back after the 2s idle while the video stays folded. `--keyboard-height` on
   the document element is the signal for the way back, with the visual
   viewport as fallback.
3. **Play/PiP/Fullscreen resolve the stream themselves.** Mobile mounts without
   resolving, so before the poster was tapped those controls were acting on an
   empty `<video>`. They all go through `withMedia` now, which primes the
   gesture synchronously and awaits the same lazy `activate` the poster uses.
4. **Live Preview timestamps — a shared-field bug.** The document-level touch
   handler and the CodeMirror one shared `touchOrigin`, and capture on
   `document` runs first: the anchor path cleared the origin on `touchend`
   before the editor path could read it, so every Live Preview tap bailed out
   as "no origin". Reading view worked because it never reaches the editor
   handler. Separate `editorTouchOrigin` field.
5. **Hub delete target** is the right 20% of the card, full height, with the
   button filling it (measured 73.5×74 on a 374px card).

### Next step

Steps 25–29 on the phone. 27 is the one that decides the design: the audio has
to keep playing while the media box is zero-height.

## Status — 2026-07-28: keyboard scroll + hub header, both reproduced

Built and installed. 140 tests pass, build clean. Both bugs were **reproduced
locally** before fixing, in a headless harness (`/tmp/ytharness`, disposable):
Obsidian's real `app.css` extracted from `obsidian.asar`, a 390×844 phone
viewport, and a hand-built copy of the phone DOM. No more guessing at iOS from
the desktop.

1. **The video slid off the top when the keyboard opened, and stayed there.**
   A markdown `.view-content` is `display: block; height: 100%; overflow:
   hidden`, and the view inside it is `height: 100%` — so prepending the docked
   player made the content exactly one player taller than its box. `overflow:
   hidden` hides a scrollbar; it does not stop the engine scrolling. iOS
   scrolled *that* box to bring the caret into view, and nothing scrolls it
   back. Measured on the old CSS: `scrollTop` 0 → 453 after a caret scroll, and
   it stays 453. Fix: `.view-content.ytfree-has-docked` is a flex column and the
   note body is `flex: 1 1 auto; min-height: 0; height: auto`, so there is no
   overflow left to scroll (`scrollHeight === clientHeight`, measured). A scroll
   listener resets `scrollTop` as a backstop. The reopen bar gets both too.
2. **The hub sat under the fixed view header — our own bug.** `HubView.build`
   put Obsidian's `is-phone` class on its `contentEl`. `.is-phone` is a *body*
   class whose rule block redeclares `--view-top-spacing: 0`; on the
   view-content it shadowed the value that Obsidian's own
   `.is-phone .mod-root … .view-content { margin-top: var(--view-top-spacing) }`
   reads, so the reserved space computed to 0. Renamed to `ytfree-phone`
   (styles.css follows). Measured: `margin-top` 0px → 111px, hub header now
   starts at y=111 against a header ending at y=104.

### Next step

Phone check: open a note with a video, tap into the body, close the keyboard —
the video must stay put; and open the hub — its filter/sync row must clear
Obsidian's header.

## Status — 2026-07-28: mobile round 2 — controls, touch links, reopen

Built and installed. 140 tests pass, build clean. **Not yet run on an iPhone** —
manual test steps 17–27 in [docs/MOBILE-UX.md](docs/MOBILE-UX.md) cover this
round.

BarkernotBob's six items from the first phone session:

1. **Full control row on mobile.** `minimalControls` is gone; the phone gets the
   desktop row (minus the timestamp button) at 38px instead of 28px. Issue 004's
   reasoning — "iOS's native controls already expose PiP, AirPlay and speed" —
   did not survive contact: no 10-second skip, no speed picker, and the overlay
   vanishes during playback. PiP/Fullscreen now fall back to
   `webkitSetPresentationMode` / `webkitEnterFullscreen`, with a status-line
   message when neither API exists.
2. **Timestamp links — a bug, not an iOS limitation.** Both handlers were
   mouse-only, and Obsidian's mobile link handling claims the link on the touch
   sequence before the synthesized mouse events arrive. Added `touchstart`/
   `touchend` twins to both the CodeMirror handler (Live Preview) and the
   document capture listener (Reading view), with a 10px tap-slop guard and
   `preventDefault()` so the seek cannot double-fire.
3. **/5. Drifting video and black note background — hypothesis, unproven.**
   Both symptoms point at `mask-image: var(--view-top-fade-mask)` on
   `.view-content`, which forces a composited layer; a `<video>` inside one is a
   known source of layer drift and black repaints on iOS WebKit. `mountPinned`
   adds `ytfree-has-docked` to `.view-content`; a 0,7,0 selector kills the mask
   while a player is docked, and `.ytfree-media` takes `translateZ(0)`. **Not
   reproduced on device.** If the symptoms survive, the mask was not the cause —
   instrument on device rather than guessing again.
4. **Closing is reversible.** A slim "▶ Show video" bar (`syncReopenBar`) takes
   the player's place in the flex column and restores it on tap.
6. **Hub top bar no longer scrolls under the header.** Real cause, and it was a
   specificity bug: `.workspace-leaf-content .view-content` (0,2,0) outranks
   `.ytfree-hub` (0,1,0), so our `padding: 0; overflow: hidden` never applied and
   the whole hub root was scrollable under a `position: fixed` header. Moved to
   `.workspace-leaf-content[data-type="ytfree-hub"] .view-content`, and made it a
   flex item (`flex: 1 1 auto; min-height: 0; height: auto`) so Obsidian's
   phone `margin-top` comes out of the height instead of pushing the bottom of
   the list off screen.

### Next step

Run steps 17–27 on the iPhone. 21 (timestamps seek), 23 (background stays) and
24 (video doesn't drift) are the ones that decide whether the reasoning held.

## Status — 2026-07-28: mobile menu structure + docked player offset

Built and installed. 140 tests pass, build clean. **Not yet run on an iPhone** —
the manual test is at the bottom of [docs/MOBILE-UX.md](docs/MOBILE-UX.md).

Three changes, all phone-only (`Platform.isPhone`); desktop and tablet untouched.

1. **The hub's menu structure is now specified** — `docs/MOBILE-UX.md` is the
   spec, with the ASCII layout and the seven rules it has to keep. The 200px
   channel column is gone on a phone; filters and channels collapse behind one
   disclosure whose label is the current selection (`New · All channels`), and
   **any selection closes it**. The panel is an absolutely positioned overlay of
   fixed height, so opening or closing it resizes nothing and moves no card.
2. **The card gives the title its width back.** With the sidebar gone and the
   state marker moved to a badge on the thumbnail, the title column goes from
   effectively zero to ~210pt on a 390pt phone — two real lines.
3. **The docked player clears Obsidian's floating header.** Root cause found in
   Obsidian's own stylesheet, not guessed:

   ```css
   .is-phone.is-floating-nav              { --view-header-position: fixed }
   .is-phone …[data-type="markdown"]      { --view-top-spacing: 0 }
   .is-phone … .cm-scroller { padding-top: var(--view-top-spacing-markdown) }
   ```

   Markdown views zero the header spacing on the container and re-apply it
   *inside* the CodeMirror scroller. The player is prepended *before* that
   scroller, so it got none and sat under the fixed header. `.ytfree-docked` now
   reserves `var(--view-top-spacing-markdown, 0px)` itself and redefines that
   variable to 8px on the following view so the scroller does not reserve it
   twice — no `!important`, and it reverts on its own when the player unmounts.

### Next step

Run the manual test in `docs/MOBILE-UX.md` on the iPhone. Steps 6 (title
readable) and 13 (video clear of the header) are the two that decide whether the
reasoning held.

## Status — 2026-07-28 (later): new-note ergonomics

- `buildWatchLaterNote` and both templates no longer emit a blank line between
  the frontmatter and `## Notes`.
- Hub-created notes open with the cursor on the empty line under `## Notes`
  (`openItem`); the Templater templates do the same via `tp.file.cursor()`.
- Vault-wide spacing between properties and body is now a CSS snippet in the
  vault (`.obsidian/snippets/tight-properties.css`) — tight gap + hairline
  divider, expanded or collapsed. Not part of this repo.

## Status — 2026-07-28: timestamp clicks fixed in both views

Timestamp links (`ytfree:` scheme) stopped seeking — Obsidian's own link
handler claims them and shows a "trust this link?" prompt. Two-part fix:

- **Reading view:** the document click listener now runs in the *capture*
  phase, beating Obsidian's bubble-phase handler (was started in a prior
  session, finished + committed now).
- **Live Preview:** links there are CodeMirror spans, not `<a>` elements, so
  the document listener never fired at all. New `Prec.highest` editor
  `mousedown`/`click` handlers resolve the link from the document text
  (`seekLinkAt` in `src/description.ts`, unit-tested). Mousedown arms the
  seek while the pre-click selection is still known, so a link the user is
  editing still takes plain clicks for cursor placement.

No note changes needed — the stored link format is unchanged. 140 tests pass,
installed to the vault; needs a plugin reload in Obsidian.

Uncommitted in the tree: hub.ts/styles.css undo-grace removal from another
session — left as found.

## Status — 2026-07-28 (latest): issue 006 built — sign in and account import

**Built and installed. 137 unit tests pass, build clean. Awaiting the manual
test** at the bottom of `docs/V1-SCOPE-ACCOUNT-IMPORT.md`.

### The gate is closed — verified end to end, before any UI

The spike's two unanswered questions were answered first, by reinstalling the
spike rather than guessing:

- **41 cookies came back out of the partition**, all eight auth cookies present.
- **yt-dlp accepted them.** `--cookies FILE --flat-playlist --playlist-end 5
  :ytsubs` exited 0 and printed five real subscription videos, empty stderr.

The spike plugin folder and the cookie file are deleted again. The session was
wiped with the spike's command 5, so signing in through the real UI starts clean.

### The one thing the scope had wrong

**`:ytsubs` is the subscription *feed*, not the subscription list.** Its entries
are videos that name their channel, so it only yields channels that posted
recently — strictly smaller than a Takeout export. The subscription manager page
`https://www.youtube.com/feed/channels` is the one whose entries are channels.

`syncAccount` asks for `/feed/channels` first and falls back to `:ytsubs` only
when it returns nothing. **`/feed/channels` has never been run with cookies** —
without them yt-dlp matches the extractor and then fails to resolve, which is
what you would expect either way. Step B6 of the manual test is what proves it:
a channel count far below the Takeout count means it fell back.

### What is built

- `src/account.ts` — no Node, no Obsidian: Netscape serialisation, the `--print`
  parsing, the Watch Later merge, the watched marking, the session status
  wording and the due/expiry rules. 14 tests.
- `src/desktop/signin.ts` — the `<webview>` modal. Its header comment is the
  spike's three rules and is the first thing to read if sign-in ever breaks.
- `src/desktop/account.ts` — the cookie file (mode 600, outside the vault) and
  `listWithCookies`.
- Settings gain a **YouTube account** section; commands gain sign in, sign out,
  and sync now. `HubItem` gains `origin` and `watched`.

### Four decisions worth knowing before touching this again

- **The build guard now also covers `@electron/remote`.** It is desktop-renderer
  only, so an eager require kills the plugin on iOS exactly like `child_process`
  would, and the old guard only knew about Node builtins. Verified by
  deliberately leaking it — the build failed with the right message.
- **A failed sync marks the session expired only when the error looks like an
  expired session.** A timeout is not a sign-out; treating it as one would log
  you out on a flaky network. Every other failure records the error and *still*
  advances `lastSyncAt`, so a broken sync waits a full period instead of
  retrying every minute. Hammering is what gets an account flagged.
- **Watched items are hidden from New and nowhere else.** All and Kept are where
  you go looking for something specific; withholding it there would be a bug.
- **Watch Later items have no publish date**, because flat mode carries none.
  That is load-bearing rather than sloppy: `expireItems` ignores items it cannot
  date, so a Watch Later item never expires out of the hub on its own.

### Not yet proven, and only a real sign-in can prove it

`/feed/channels` with cookies (above); the display-name probe, which is a fixed
regex over two known fields and falls back to a nameless "Signed in"; and
acceptance criterion 7 — that playing in Obsidian leaves no trace in YouTube
history. That last one is step E of the manual test and is the reason the whole
design exists.

## Status — 2026-07-28: issue 006 approved, gate spiked and passed (superseded)

Sign in to YouTube from inside Obsidian and import subscriptions, Watch Later
and history. Scope is `docs/V1-SCOPE-ACCOUNT-IMPORT.md`, **approved 2026-07-28**.
No implementation code exists yet.

### Why this exists at all

BarkernotBob asked for a hybrid: the account pulls **data** in, but playback stays
anonymous so nothing watched in Obsidian is attributed to his YouTube account.
He accepted that Obsidian views will not appear in his watch history, and
accepted that members-only and age-restricted videos stay unplayable here.

He explicitly refused `--cookies-from-browser`: **"I don't want you pulling from
my browser at all. I want to be able to click to sign-in."** No reading of
Chrome/Arc/Safari cookie stores, ever. That constraint is what forced an in-app
sign-in window rather than the much easier browser-cookie route.

### What is settled

- **OAuth cannot do this.** `watchHistory` and `watchLater` were deprecated on
  the channel resource in Aug 2016 and return literal `HL`/`WL`. The Data API
  gives subscriptions and neither of the other two. Cookies are the only
  mechanism that meets the request. Don't re-litigate this — it was researched.
- **The gate is clear.** Spiked on `prototype/signin-spike`; findings are in
  that branch's `prototypes/signin-spike/README.md`, which is worth reading
  before writing the sign-in code.

| Tried | Result |
|---|---|
| `BrowserWindow` + UA spoofed to Chrome 142, at `accounts.google.com/ServiceLogin` | **blocked** |
| `<webview>` in a Modal, **UA untouched**, at `youtube.com` | **signed in, first try** |

Three rules follow, and they are the reason the spike was worth running:

1. **Never spoof the user agent.** It is the one change that produced a block.
2. **No client-hint rewriting.** Built during the spike, never needed, deleted.
3. **`<webview>` in a Modal, pointed at `youtube.com`** — sign in from the avatar
   menu. Never navigate to `ServiceLogin`; that is where the check lives.
   Media Extended's v3 `apps/app/src/login/modal.ts` is the reference shape.

Remote module is `require("@electron/remote")`.

### What is NOT settled — and it is step 1

**Whether the session cookies can be read back out of the partition, and whether
yt-dlp accepts them for `:ytsubs`.** The spike was removed before those commands
ran. Do this before writing any UI: sign in, dump cookies to a Netscape file,
run `yt-dlp --cookies FILE --flat-playlist --playlist-end 5 :ytsubs`. If it
fails, the rest of the scope is dead and the Takeout CSV stays the only way in.

### Standing constraints for this issue

- The cookie file lives **outside the vault**, mode `600`. The vault is in
  iCloud; a live Google session must not sync to two Macs and Apple's servers.
- A captured session cookie is **unscoped full Google account access**, not a
  scoped token. BarkernotBob was told this and accepted it.
- yt-dlp warns that recurring authenticated requests can get an account flagged.
  BarkernotBob was told this twice, chose to proceed, and it is recorded in the scope
  so it is not rediscovered later as a bug. Mitigations are the 12h default and
  stop-on-expiry. Do not silently increase the poll rate.
- Cookies go on account-data calls **only**. Never on playback, stream
  resolution, RSS polling, transcripts or downloads. That split is the feature.

### Spike cleanup already done

Vault plugin folder, the 59 MB Electron partition holding the live session, and
the cookie directory are all deleted. `prototype/signin-spike` is pushed and
stays as the record; it never merges. Note `.obsidian/plugins/ytfree-spike/`
(the 004 mobile-iframe spike) was **left alone** — it belongs to 004 and was not
mine to remove.

## Status — 2026-07-28: issue 004 built — mobile viewer

Issue 004 is **built and installed**. 123 unit tests pass, build clean.
**Awaiting the manual test** at the bottom of `issues/004-mobile-viewer.md`.

**Say this plainly to BarkernotBob: none of the iOS behaviour has been run on a real
iPhone.** What is actually verified is narrower than "it works on mobile":

- the bundle contains **no Node builtin `require` that runs at load** (checked on
  `main.js`, and now enforced by the build itself — see below);
- the InnerTube parser is tested against **real captured responses**, not
  hand-written JSON;
- desktop still passes everything it passed before.

What is *not* verified: whether `requestUrl`'s custom User-Agent reaches YouTube
from iOS (risk 1 in the issue), and whether WKWebView will load a googlevideo URL
into a `<video>` element (risk 2). Both are step B4 of the manual test. If B4
fails, the whole approach is in question, not a detail of it.

### The shape of the change

Everything that touches Node moved under `src/desktop/` behind **one door**:
`await import("./desktop")`, inside a `Platform.isDesktopApp` branch. esbuild
keeps a dynamically-imported subgraph in a lazily-initialised closure, so the
`require` calls happen on first use rather than at startup — which is the whole
game, because on iOS a top-level `require("child_process")` throws *before*
`onload`, so the plugin dies rather than degrading.

- `src/stream.ts` — the platform-neutral core (`extractVideoId`, `parseExpiry`,
  `StreamCache`, the `ResolvedStream` shape). Imports nothing.
- `src/desktop/` — `resolver.ts` (yt-dlp), `download.ts`, `transcript-fetch.ts`,
  `shorts-probe.ts`, and `index.ts` as the only entry point.
- `src/mobile/innertube.ts` — the request. `src/mobile/player-response.ts` — the
  parsing, split out purely so the tests can run it without `obsidian`.
- `manifest.json` lost `isDesktopOnly`.

### The build now enforces the rule that matters

`esbuild.config.mjs` fails the production build if any Node builtin is required
in the eager module body. This is the highest-value thing in the change: one
ordinary top-level import in a file mobile loads pulls the whole desktop subgraph
back into startup, the source diff looks completely innocent, and the only
symptom is the plugin refusing to load on a phone you are not holding. Verified
by deliberately introducing a leak — the build failed with the right message.

### Four things worth knowing before touching this again

- **Issue 004's list of Node imports was incomplete.** `src/subscriptions.ts`
  also imported `https`, for the Shorts probe, and it sits directly on the mobile
  load path. Mobile now leaves `isShort` null, which already meant "ask again
  later". Do not trust a hand-written list of imports over the build guard.
- **`DEFAULT_SETTINGS.downloadFolder` used to call `os.homedir()` at module
  scope** — a Node call at load time, exactly the failure being fixed. It is now
  `""`, meaning "the default", resolved lazily via `defaultDownloadFolder()`.
- **Mobile defers the resolve until you tap.** The player mounts with its final
  height reserved and a thumbnail poster; nothing is fetched until a tap on the
  poster or on a timestamp. Opening a note should not cost a video.
- **`player.primeForGesture()` exists for one iOS rule**: `play()` after an
  `await` is refused as not user-initiated. Touching the element synchronously
  inside the tap handler claims the gesture and survives the later `src` swap.
  This is anticipated, not observed — if playback needs a second tap on the
  device, this is the code to look at first.

### Fixtures

`tests/fixtures/*.json` are real captures, re-recordable with
`node spikes/innertube/record.mjs`. The `ip=` parameter is redacted in both the
query form and the `/ip/…` path form used by manifest URLs. The signed URLs
expire in about six hours, which is fine — nothing in the tests fetches them.

`node spikes/innertube/probe.mjs` remains the load-bearing measurement: green
means InnerTube still hands out unciphered, playable URLs. Run it first if mobile
playback ever stops working.

## Status — 2026-07-27: subscriptions hub built

Issue 003 is **built and installed**. 113 unit tests and 7 live smoke tests
pass, build clean. **Awaiting the 18-step manual test** at the bottom of
`docs/V1-SCOPE-SUBSCRIPTIONS.md`.

Subscribed channels are polled on a schedule, new videos land in a hub view, and
clicking one turns it into a Watch Later note with the player already pinned.
Nothing here replaces RSS Dashboard for podcasts — only the YouTube half.

- `src/subscriptions.ts` — all the rules, no Obsidian: feed parsing, the Takeout
  CSV, merge, expiry, the note shape, the Shorts probe. 30 tests.
- `src/hub.ts` — the state file, the poller, the view, the import dialog.
- Storage is `.obsidian/plugins/ytfree/subscriptions.json`, deliberately not
  `data.json`: the index runs to thousands of rows and a poll should not rewrite
  the settings file.

### Three findings that only showed up against live data
- **The feed header's `<yt:channelId>` drops the `UC` prefix**, while the same
  tag inside an entry keeps it. The live smoke test caught this; nothing written
  from the spec would have. The parser reads the ID off the self link instead.
- **A nonexistent video ID answers 200 to the `/shorts/<id>` probe**, same as a
  real Short. So "200 means Short" only holds for IDs that came from a feed, and
  any other status is recorded as "unknown, ask again" — never as long-form.
- **Expiry runs before the Shorts probe.** On a first import that is the
  difference between a few dozen HTTP requests and fifteen hundred.

### Decisions worth keeping
- **Clicking a video does not remove its card.** Under the New filter, marking an
  item Kept would drop it out of the list and pull everything below it upward —
  the reflow-on-click the global rule forbids. The card stays put and only its
  marker changes; the list re-filters on the next refresh, poll or filter change.
- **Descriptions are cached at poll time**, which is the hub's whole reason to
  exist over an RSS reader. The feed is a rolling 15-entry window; by the time
  you click, the video may have fallen out of it.
- **Expiry is measured from the publish date, not from when we first saw it.** A
  fresh import then trims itself to the last 30 days instead of dumping every
  channel's whole window into the hub, and "30 days" means the same thing on
  both Macs.
- **Expiry never touches a file.** It removes a row from a JSON index. Kept items
  are exempt, and deleting a note by hand does not resurrect the item.
- **Re-importing Takeout never removes a channel.** Unsubscribing on YouTube is
  not a statement about what you want to keep seeing here.
- **The poll ticker asks "is it due yet" every minute** rather than being an
  interval set to the poll period, so changing the period in settings takes
  effect immediately rather than at the next restart. Poll-on-load is skipped if
  the last poll was under five minutes ago.
- **The Takeout CSV is parsed by header name with a positional fallback.** The
  exact column names were never verified against a real export, and an
  unrecognised header must not silently import zero channels.

### Known limitation, documented rather than fixed
The 15-entry window has no backfill. If Obsidian stays closed longer than a
channel takes to publish 15 videos, those videos are missed permanently.
Polling on startup narrows it; nothing closes it.

## Status — 2026-07-27 (transcript auto-fetch): mobile re-scoped, nothing built

**Start the next session here.** Nothing in `src/` changed. Two issues were
rewritten, one spike was added, and the mobile plan changed shape entirely.

### What changed and why

The iframe route is dead and the GitHub Pages shim is rejected. **Mobile will
resolve the stream in the plugin and play it in a plain `<video>` element** — the
same thing desktop does, with InnerTube standing in for yt-dlp.

- **The error-153 confound is closed.** oEmbed returns `200` for `h0EGCnBjTVk`,
  so embedding is *enabled* and the embed still refused to play. The cause is
  `capacitor://localhost` not being an http(s) origin, and nothing the plugin
  passes can fix that.
- **InnerTube returns unciphered, playable URLs.** Measured 10/10: status OK,
  zero `signatureCipher` formats, itag 18 (360p muxed) on every video, and those
  URLs serve bytes with no PO token. No `base.js`, no eval, no crypto — which is
  what makes this a different proposition from the "reimplement yt-dlp" that the
  old issue 004 correctly rejected.
- **Mobile therefore ends up ad-free**, plus native PiP, AirPlay, background
  audio, and lock-screen transport.
- **HLS is gone** (1 of 10 videos) and `dashManifestUrl` never appears on any
  client version 17.x–20.x. Do not design around either.

### The split

- **[Issue 004](issues/004-mobile-viewer.md) — v1, 360p.** itag 18 into a
  `<video>`, docked at the top of the note. Seeking becomes
  `video.currentTime = secs`, which deletes the whole postMessage handshake.
- **[Issue 005](issues/005-mobile-full-quality.md) — v2, full quality.** Separate
  video/audio streams, so MSE, a synthesized manifest, and a custom loader
  (googlevideo sends no `Access-Control-Allow-Origin`, so plain `fetch` is
  blocked). iOS 17.1 floor via `ManagedMediaSource`.

360p ships first on purpose: the risk in 004 is not the resolver, it is getting
the plugin to load on iOS at all — every Node import is currently top-level and
throws at module load. That work should not wait behind a media-engine project.

### Next step

1. `node spikes/innertube/probe.mjs` — five seconds, and the entire plan rests on
   it. Baseline 2026-07-27 is 10/10 PASS.
2. Then §1 of issue 004: `src/desktop/`, the new `src/stream.ts`, drop
   `isDesktopOnly`. Desktop must not change behaviour.

Open call for 005, not yet made: spike the paired `<video>`+`<audio>` route
(route C) for one sitting first. If sync holds, it deletes that issue's entire
media-engine cost.

## Status — 2026-07-27 (transcript auto-fetch)
Transcript now fetches **automatically for new notes**, from both the template
and the Web Clipper. 83 unit tests pass, build clean, installed. **Awaiting
manual test** — the automatic path is event-driven inside Obsidian and is the
one part of this that no test here can exercise.

## What just changed (auto-fetch)
- **Automatic fetch for notes created this session.** No template or clipper
  change was needed: both create a file, and that single condition covers both
  without either side knowing the plugin exists.
- **"Created this session" is the whole gate**, and it is deliberate. Opening an
  old note must never trigger a surprise yt-dlp call and a five-thousand-word
  append. Old notes still have the command.
- **`vault.create` is registered only after `onLayoutReady`.** Obsidian fires
  `create` for every existing file during startup; registering earlier would
  make the entire vault look new and queue a fetch for all of it.
- **Driven off `metadataCache.changed`, not `create`.** A Templater note is
  empty at create time — the frontmatter naming the video does not exist yet.
  `create` and `file-open` also try, which costs nothing: with no video ID yet
  the call returns without recording an attempt, so a later event still fires.
- **Renames are tracked.** Templater renames the note after filling it in, so
  the path recorded at create time is not the path the fetch would see.
- **Fetches are serialized and delayed 1.5s.** Clipping four videos in a row
  must not start four yt-dlp processes, and the delay lets the template finish
  writing rather than racing it for the file. Content is re-read at the last
  moment, so a note that gained a transcript in between is left alone.
- Failures still speak up. Only the "nothing to add" case is silenced on the
  automatic path — a note silently missing a transcript is indistinguishable
  from a video that has no captions.
- Off switch: Settings -> YT Free -> Transcript -> *Fetch automatically for new
  notes*.

## Next step — manual test (automatic path)
1. Relaunch Obsidian.
2. New note from `Templates/8.Watch_Later_Template.md`. Within ~10s expect a
   "fetching transcript..." notice, then `## Most replayed` and `## Transcript`
   appear on their own. Confirm Notes and Description survived.
3. Clip a video with the Web Clipper. Same result, no command run.
4. **Open an old Watch Later note. Nothing should happen.** This is the check
   that matters most.
5. Clip two videos back to back — the second fetch should start after the first
   finishes, not alongside it.

## Status — 2026-07-27 (subscriptions hub scoping)
**Issue 003 (subscriptions hub) is scoped, not built** — see
`docs/V1-SCOPE-SUBSCRIPTIONS.md`. Nothing in `src/` changed. It replaces RSS
Dashboard for the YouTube half only; RSS Dashboard stays for Overcast podcasts.
The load-bearing finding is that the channel feed carries the full description,
so the note path needs no watch-page scrape — but the feed is a rolling
**15-entry** window, which is the constraint the whole design has to respect.

Transcript + most-replayed shipped. 83 unit tests pass, build clean, installed
to the vault. Verified end to end against a real video (Mark Rober,
`h0EGCnBjTVk`): uploaded captions found, 520 cues → 25 sections, 8 replay peaks,
27KB note. **Awaiting manual test.**

## What just changed (transcript command)
- **New command: "Fetch transcript and most-replayed moments".** Answers the
  case that started this — a video whose uploader wrote no chapters, which is
  most of them. Writes two sections into the note.
- **`## Transcript`** — the full transcript, grouped into ~60-second sections
  (configurable 15–180s), each headed by a seek link. The point is not reading
  it top to bottom: search a phrase in the vault, click, and the pinned player
  lands on the second it was said.
- **`## Most replayed`** — YouTube's replay heatmap, top 8 peaks (0–20). A
  greedy minimum-gap pass is what makes this useful: the heatmap is sampled
  every ~15s and one spike covers several buckets, so sorting by value alone
  returns the same moment eight times. Each peak is labelled with the transcript
  line spoken there, because a bare timestamp tells you nothing.
- **One `yt-dlp -J` call** (~3s) yields both the caption-track list and the
  heatmap. The caption URL it returns is already signed and immediately valid,
  so it is fetched directly — no second yt-dlp call, no temp files.
- **Uploader captions beat auto-generated** when both exist. Language keys match
  by prefix: YouTube's multi-language audio produces `en-US-<id>` where you
  expect `en`, which is exactly the shape the test video has.
- **`upsertSection` replaces, never duplicates.** A section runs to the next
  `## `, so re-running the command leaves your Notes and the Description alone.
  An empty body deletes the section rather than leaving a bare heading.
- `allowImportingTsExtensions` is now on: `node --test` runs the TS sources
  directly and resolves imports literally, so `transcript.ts` importing
  `format.ts` needs the extension.

## Next step — manual test
1. Relaunch Obsidian (new `main.js`).
2. Open a Watch Later note, run **YT Free: Fetch transcript and most-replayed
   moments** from the command palette. Expect a notice, then ~3–8s, then two new
   sections at the bottom.
3. Click a transcript timestamp and a replay peak — both should seek the pinned
   player.
4. Run the command a second time: sections should be replaced, not duplicated,
   and your Notes untouched.
5. Search the vault for a phrase from the middle of the video, click through
   from the search result, confirm it lands at the right moment.
6. Settings → YT Free → Transcript: drop section length to 15s, re-run, confirm
   more sections; set most-replayed to 0, re-run, confirm the section is gone.

## Previous status — 2026-07-26
Note-shape pass: properties collapse, in-note player retired, description with
clickable chapters. 58 unit tests pass, build clean, installed to the vault.
**Awaiting manual test (see below).**

## What just changed
- **Properties collapse on video notes.** Opening a note whose frontmatter names
  a video folds the properties table, so the pinned player and the note text are
  what you land on. Obsidian's own collapse toggle is clicked rather than the
  `is-collapsed` class being set, so its internal state and the arrow agree and
  the first click to re-open works. Done once per note per view — expanding by
  hand sticks until you open a different note. Off switch in settings.
- **No more in-note player.** The ```ytfree fence is gone from the Templater
  template and both Web Clipper templates; the pinned player is the only player.
  The fence still works for notes that already have one (it renders the stub).
- **`## Description` with clickable chapters.** Bare `mm:ss` / `h:mm:ss` text in
  a note that names a video renders as a seek link into the pinned player, using
  the same `ytfree:<id>:<secs>` scheme flow capture writes. This lives in the
  plugin, not the templates, because the Web Clipper can copy a description but
  cannot rewrite it — and doing it at render time also fixes notes clipped
  before today.
  - The Templater template additionally writes **real markdown links** into the
    file, because it has the video ID at creation time and a link in the source
    survives the plugin being off.
  - `src/description.ts` holds the matcher: guards keep `1:02:03` from also
    yielding `02:03`, keep decimals like `1.5:30` out, and skip anything already
    inside a markdown link.
- **Templater now scrapes the watch page.** oEmbed carries no description, so
  `shortDescription` and `lengthSeconds` are read out of the page HTML. Failure
  is non-fatal: the note is created with the description section empty.

## Next step
Manual test:
1. Relaunch Obsidian (new `main.js`).
2. New note from `Templates/8.Watch_Later_Template.md`, paste a URL for a video
   that has chapters. Expect: properties collapsed, one player at the top, no
   fence, `## Description` populated with clickable timestamps.
3. Click a chapter timestamp — the pinned player should seek there.
4. Expand properties by hand, scroll, switch tabs and come back — they should
   stay expanded until you open a different note.
5. Re-import `System Templates/Obsidian Clipper - Watch Later (YT Free).json`
   into Web Clipper, clip a video, confirm the same shape.

## Previous status — 2026-07-26
Issue 002 (offline download) built and installed. 51 unit tests pass; the yt-dlp
argument shape was verified against a real 19-second download. **Awaiting the
14-step manual test in `issues/002-local-download.md`.**

A pickup note for the download work also lives in the vault at
`MyVault/YT Free — Offline Download Plan.md`, per BarkernotBob's request.

## What just changed (issue 002)
- **Download button + two commands.** Downloads the note's video to
  `~/Movies/YT Free/`, writes `local_media:` into the frontmatter, and swaps the
  running player onto the file at the same position — the swap is invisible.
- **`media_link` is never replaced.** Timestamps are keyed by video ID parsed out
  of that URL; replacing it with a path would kill every `ytfree:` link in the
  note, lose provenance, and make re-download impossible.
- **Files live outside the vault** (iCloud). That means frontmatter syncs to the
  second Mac and the file does not, so that Mac silently streams. Deliberate.
- **`<title> [<videoId>].mp4`.** If the recorded path is gone, the folder is
  searched for the bracketed ID, so renaming in Finder is harmless.
- **No ffmpeg on this Mac**, so the pre-muxed fallback is the live path today,
  not a corner case. Downloads say so rather than failing.
- Local playback goes through Obsidian's `app://local/` handler; `file://` is
  blocked by the renderer. A bad local file falls back to streaming once.
- `src/download.ts` isolates everything testable without Obsidian.

## Next step
Manual test (issue 002). Relaunch Obsidian first.

## Previous status — 2026-07-26 (later)
Pinned player shipped and installed; ad-hoc playlist URLs now resolve.
All automated tests pass: 41 unit, 5 live. **Awaiting manual test.**

## What just changed
- **Pinned player.** When a note's frontmatter names a YouTube video
  (`media_link`, then `url` — configurable), the full player mounts above the
  note body inside `.view-content` and stays put while the note scrolls. This
  replaces the Media Notes plugin, which owned that spot and has been disabled
  in the vault's `community-plugins.json`.
- Same player as the fenced block — controls, speed, PiP, timestamp, stream
  recovery — because both now go through one `buildPlayer()`.
- A ```ytfree fence whose video is already pinned renders a one-line stub
  instead of a second player, so nothing double-buffers or fights over the
  `players` map key.
- Height is a fixed `vh` from settings, not content-driven: nothing the player
  does can reflow the note text under it.
- `syncPinnedPlayers()` is idempotent and reconciles on layout-change,
  active-leaf-change, file-open and metadata changes; an `isConnected` check
  catches Obsidian rebuilding a view's DOM underneath us.
- **`watch_videos?video_ids=a,b,c` parses.** YouTube's ad-hoc playlist URL names
  no single video, so `extractVideoIds()` returns the whole queue and
  `extractVideoId()` takes the first. Handles `%2C` and plain commas.

## Next step
Manual test in Obsidian (relaunch first — Media Notes only stays off after a
restart): open a Watch Later note, confirm one player at the top, confirm
timestamps still stamp and seek, confirm no double player under the fence.

## Previous status — 2026-07-26
v1 confirmed working in Obsidian. Issue 001 (flow capture) is built and installed;
**two rounds of manual-test feedback applied, awaiting re-test.** All automated tests
pass: 39 unit, 5 live.

## What just changed (third pass)
- **Displayed time and seek target are now different numbers.** `{ts}` shows the moment
  the line was written; `{link}` / `{seconds}` point `lookbackSeconds` earlier. A line
  reading `3:05` seeks to `3:00`. Reading and replaying want different answers.
- **Enter no longer pauses the video.** Pausing moved off `updateListener` (which fires
  for Enter and for programmatic writes) onto the same `inputHandler` as stamping, so only
  real character input pauses.
- **On bulleted lines the stamp waits for the first word.** Typing `-`/`*`/`+` doesn't
  stamp, and neither does whitespace, so the bullet is typed clean and Obsidian renders
  the list; the stamp then arrives with the text: `- [3:05](…) text`. An earlier pass
  skipped bulleted lines entirely — that was wrong, they should stamp.

## What changed in the second pass
- **The trigger moved from Enter to the first character typed on a line.** Enter failed
  twice in real use: the first line of a note never got stamped (you don't press Enter to
  reach it), and Enter writing text raced with the typing that followed. Now
  `EditorView.inputHandler`, and Enter is untouched.
- **Play/pause is no longer part of the stamp decision.** The old gate was "playing OR
  paused-by-us", which still skipped stamps when the user paused by hand. Replaced with a
  single `hasPlayed` guard, which exists only to stop an unplayed note stamping 0:00.
- `stampInsertOffset()` decides where the stamp goes; it fires after indentation, list
  bullets, checkboxes, quotes and headings, so auto-continued list lines still stamp.
- Player gained `hasPlayed`. `isPlaying` / `isPausedByTyping` remain but no longer gate
  stamping.

## What changed in the first pass
- Issue 001 implemented: auto-timestamp, lookback offset, pause-while-typing. All three
  on by default (`lookbackSeconds: 5`, `resumeIdleMs: 2000`).
- New `src/capture.ts` holds the pure decision logic — lookback maths, the stamp gate,
  fence detection — so the part most likely to break is unit-testable without an editor.
- `src/player.ts` gained `pauseForTyping` / `resumeAfterTyping` and a `pausedByTyping`
  flag, plus `isPlaying`.
- `src/main.ts`: players are now `PlayerEntry { player, videoId, sourcePath }` so capture
  can ask "which player is in *this* note" instead of falling back to any player.
- Typing is detected with an `EditorView.updateListener` for the pause behaviour.
- `esbuild.config.mjs` now marks `@codemirror/*` external — verified in the built
  `main.js`.
- New unit suite `tests/capture.test.ts`.

## Exact next step
Reload the plugin in Obsidian, then run the manual test in `issues/001-flow-capture.md`
(sections A–G). Section B is the one that was broken and is worth checking first.

## Key decisions worth remembering
- Notes store **video IDs only**. Never write a resolved URL to disk; they expire and are
  IP-locked. This is the core design constraint.
- **The stamp gate must not test play/pause at all.** Two versions of this were wrong:
  `!video.paused` (dead on arrival, since pause-while-typing pauses first) and then
  "playing OR paused-by-us" (still skipped stamps when the user paused by hand). The
  position is well defined in every state, so the gate doesn't ask. Guarded by a named
  regression test that also asserts no `isPlaying` field exists on the gate input.
- **The trigger is typing, not Enter.** Enter can't stamp the first line of a note, and
  an Enter that writes text races with the typing after it. Enter must also not pause —
  which is why pausing hangs off `inputHandler` and not off `updateListener`.
- **Never stamp on the bullet character or on whitespace.** A stamp before the bullet
  stops Obsidian rendering the list; a stamp on the space strands the text after it. The
  correct trigger on a list line is the first word.
- **`{ts}` and `{link}` intentionally disagree.** The text shows where you were; the link
  lands `lookbackSeconds` earlier. Making them match again would undo the point.
- **`pausedByTyping` is only ever set by a pause we performed**, because `pauseForTyping`
  no-ops on an already-paused video. That is what stops the idle timer resuming a video
  the user paused themselves.
- **CodeMirror must stay external in the esbuild config.** Bundling a second copy means
  our keymap registers against a different module instance and never fires. This failure
  is silent — no error, the key just does nothing.
- Resolution timing is unstable: measured 28s cold, then ~4s warm. yt-dlp appears to
  cache its JS challenge solver. Do not treat a single slow run as a regression — re-run.
- `ios` player client is broken (returns images only). `android_vr` is the fast client
  but exposes 360p only. Both facts drove the two-stage design.

## Open risks
- 5s lookback is a guess, not a measurement. It is a slider for that reason.
- Players are keyed by video ID alone, so the same video open in two notes collapses to
  one entry (last render wins). Flow capture would target the wrong note. Edge case, left
  unfixed deliberately — see the comment on `PlayerEntry`.
- `EditorView.updateListener` fires on any doc change, not strictly on keystrokes. A sync
  or another plugin writing to the note will also pause playback.
- `npm` flagged esbuild's postinstall script as unapproved. Build works, so it was not
  needed, but a clean clone may need `npm approve-scripts`.
