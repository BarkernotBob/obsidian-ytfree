# 012 — Where you left off, transcripts on the phone, and a row you can hit

Status: **Built 2026-07-29 — awaiting manual test.**

Five asks from BarkernotBob. Two are the card layout finishing what
[011](011-card-trim-and-filter-names.md) started, one is a feature the plugin
never had, and one is a limitation nobody had noticed was a limitation.

---

## 1. The byline moves under the picture

The phone card put `channel · age` in the title column, where it had the card's
width minus the 112px picture minus the 112px dismiss target — about 150pt — and
"3 weeks ago" was routinely the half that got cut.

It sits **under** the picture now, across the card's full content width: 269pt
instead of 150pt, measured. The picture pays for the line it gained, coming down
from 128×72 to **112×63**; the card goes from 92px to **100px** and seven still
fit a 390×844 screen.

The line is two elements rather than one string, because they fail differently:

- **the age never ellipsizes** — it is a rigid track, four or five characters;
- **the channel is the only thing allowed to** — it is the part you still
  recognise from its first two thirds.

A joined string can only cut from the right, which cut exactly the wrong one.
`phoneSub()` is now a thin wrapper over `phoneSubParts()`, which the card uses.

Measured with `tools/phone-hub-harness.mjs` against the vault's longest real
channel names ("Technology Connections Extra") and longest ages ("11 months
ago"): **0 of 12 cards clip the channel, the age or the duration**.

**A bug fixed on the way:** search-result cards inherited the hub card's
two-column grid and laid themselves out against a 112px dismiss track that a
result never has. They get a single-track grid now — the result byline goes from
269pt to 372pt, and this was probably the clipping BarkernotBob was actually seeing.

## 2. Scroll room under the last card

Obsidian's floating mobile toolbar sits over the view, and the last card was
under it however far you scrolled. The hub list gets
`88px + env(safe-area-inset-bottom)` of bottom padding — scroll room at the end,
not a gap in the layout, and it clears the toolbar and the home indicator.

## 3. It remembers where you got to

New: `src/progress.ts` (the rules, pure and tested) and `src/progress-store.ts`
(the file). A position is recorded per **video**, not per note — the same video
opened from two notes is one position, which is the answer you want.

- Reopening a note **lands you where you were**, on both platforms.
- Desktop says so for six seconds in the status line it already reserves:
  *"Picking up at 12:34"*. Silence would look like a bug.
- The phone says so on the poster before you tap: a **`Resume 12:34`** badge.
- Under 15 seconds in is not worth remembering; **near the end clears the
  entry**, so a video you finished reopens at the start rather than at its own
  credits. "Near the end" is the more generous of 20 seconds or 3%, which is
  what makes it right for both a 90-second clip and a two-hour talk.
- Positions are reported every 5 seconds while playing, immediately on pause,
  seek and end, and on teardown — iOS can end the process without warning, so
  waiting for `destroy()` would lose the last however-many minutes.
- Written to `progress.json` beside `subscriptions.json`, debounced to 4s.

**Not in the note's frontmatter**, deliberately: a position changes every few
seconds, and writing that into the note would rewrite a synced file
continuously, produce iCloud conflict copies, and put a document change under
the cursor of anyone typing in the note at the time.

## 4. Transcripts on the phone

BarkernotBob's premise was right — `queueAutoFetch` returned early on mobile, because
fetching a transcript meant shelling out to yt-dlp and there is no Node on iOS.

The phone gets its captions from InnerTube instead, proved live before any of it
was written: the ANDROID player response carries `captionTracks`, its `baseUrl`
defaults to `fmt=srv3` XML, and `fmt=json3` can be forced because the signature
covers `sparams`, which excludes `fmt`. Human captions are preferred over
auto-generated, exact language over regional.

Auto-fetch, the command and the setting are no longer desktop-only.

**A limitation stated here that turned out not to be one:** this issue shipped
saying most-replayed moments were desktop-only, on the basis that the heatmap
lives only in yt-dlp's info JSON. That was wrong — it was looked for under the
wrong key. It is in InnerTube's `next` response, on the WEB client, under
`frameworkUpdates`. [013](013-heatmap-on-the-phone.md) does it.

## 5. The control row

Two separate complaints, two separate causes.

**The numerals.** "10" was tucked into the bottom-right corner of each skip
button, which put the two numerals 40px apart on the outside edges of a
symmetrical pair and read as two labels that had slipped. The badge now spans
the button's full width and centres its text, and the chevrons move up 4px so
the two share the button instead of overlapping in it. Measured: both numerals
sit **0px** off their button's own axis.

**The spacing.** Every control was 6px from every other, so the row read as one
undivided run of nine targets and the button next to Play was as easy to hit as
Play. The gap between groups is now twice the gap inside them, and the phone —
where the fat-fingering was — stops shrinking its buttons: 36pt targets with 4pt
between them become **40pt targets with 8pt between them**, paid for out of the
speed picker's width. `tools/controls-harness.mjs` is new and measures it at
375, 390, 430 and 700pt: no overflow anywhere, smallest target 40pt, smallest
gap 8pt, Play 0px off centre.

---

## Acceptance criteria

- [x] Phone card byline sits below the thumbnail and spans the card.
- [x] Channel, upload age and duration never clip on any of 12 measured cards,
      worst-case names included; only a long title still truncates.
- [x] Every card is the same height (100px) and nothing overflows.
- [x] Search-result cards are the same height and use the full card width.
- [x] The hub list has scroll room past the last card for Obsidian's toolbar.
- [x] Playback position survives closing the note and closing Obsidian, and is
      surfaced on both platforms before you have to wonder about it.
- [x] A finished video does not resume at its own credits.
- [x] Transcripts fetch on a phone-created note, automatically and by command.
- [x] Skip-button numerals are centred on their buttons.
- [x] Phone control targets are 40pt with 8pt between them, no overflow at
      375pt.
- [x] `npm run check` clean: 211 tests, build clean.

## Manual test (for BarkernotBob)

Phone first. Force-download the vault and fully relaunch Obsidian.

1. Open the hub. The channel and "3 weeks ago" should now be **under** the
   picture, running the width of the card. Scroll the whole list looking for a
   cut-off channel or age — there should not be one. Only titles truncate.
2. Scroll to the very bottom. The **last video should scroll clear** of
   Obsidian's floating toolbar rather than sitting under it.
3. Search for something. The result cards should be the same size as hub cards
   and use the **full width** — no empty strip on the right.
4. Open a video from the hub and let it play for a minute or two. Note the time.
5. Close the note. Reopen it. The poster should show a **`Resume 12:34`** badge
   with roughly where you stopped; tap it and playback should **start there**.
6. Force-quit Obsidian entirely, reopen, open that note again. The badge should
   still be there with the same time.
7. Watch one short video to the end. Reopen it — it should have **no badge** and
   start from the beginning.
8. Create a **new video note on the phone** (open something from the hub you
   have not opened before). Within a few seconds you should get a
   "fetching transcript…" notice and a **Video Transcript** section in the note.
   (Since [013](013-heatmap-on-the-phone.md), a **Most replayed** section too.)
9. Look at the control row. The **10s** on the back and forward buttons should
   sit centred under the chevrons and mirror each other exactly.
10. Tap the buttons either side of Play a few times without aiming carefully.
    They should be easier to hit than before and you should not land on Play.

Then on the Mac:

11. Open any video note, play a minute, close it, reopen it. It should start
    where you stopped, with a grey *"Picking up at 12:34"* under the player for
    six seconds.
    (Positions travel between the Mac and the phone only once iCloud has synced
    `.obsidian/plugins/ytfree/progress.json`, which is not instant — so treat
    cross-device resume as a bonus, not as part of this test.)
12. Run **Fetch transcript and most-replayed moments** on the note from step 8.
    The heatmap section should appear alongside the transcript. (Since
    [013](013-heatmap-on-the-phone.md) the phone has already written it, and
    simply opening the note backfills an older one — so this step is now a
    check that re-running is still safe rather than the only way to get it.)
