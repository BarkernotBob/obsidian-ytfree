# HANDOFF

## Status — 2026-07-31: Preview plays (024)

Stage three of the card-controls scope. **391 unit tests pass, build clean,
installed to the vault.** The Preview modal now holds a real ad-free player on
both search results and hub cards; nothing in it has been seen on a screen yet,
and the manual test in [issues/024-preview-plays.md](issues/024-preview-plays.md)
is the next thing to run.

- **One engine, three surfaces.** `buildPlayer` grew a `preview` flag rather
  than a second implementation, so the fence, the pinned player and the preview
  cannot drift on recovery, quality or Smart Speed. What `preview` switches off
  is exactly the note-coupled set — download, section jumps, pin — because each
  needs a note to act on.
- **The preview player is deliberately not in `players`.** That map is keyed by
  video ID and every note feature reaches through it, so a preview of a video
  whose note is open would evict its entry and break timestamp capture, the pin
  and section jumps, then delete it again on close. It is the `preview` field
  instead; `livePlayers()` is the iterator for things true of playback itself,
  and `entryOf(player)` replaced two lookups that were keyed by video and are
  now keyed by identity. **This is the invariant most at risk from a later
  "just put it in the map" change.**
- **Watch closes the sheet before it runs.** Closing destroys the player,
  destroying reports the final position, and only then does the note open and
  ask `resumeFor`. Reversing those two lines gives you two streams and a
  position five seconds stale — the ordering is the feature.
- **Preview records the position, never the watch stamp**
  (`ProgressStore.recordPosition`). A preview that counted as a view would
  punish previewing, and a hub that punishes previewing is one where you press
  Watch on everything.
- **What is still not built:** stage two — the persistent search blocklist, the
  `⋯` Hide-channel chip, and the Settings lists that undo both. The session-only
  `removedResults` set in `hub.ts` is still the seam it plugs into.

## Previous — 2026-07-30j: feed failures are retried, and no longer sticky

`youtube.com/feeds/videos.xml` fails at random — the same live channel answered
404, 404, 404, 500, 404, 404, 404, 500 and then 200, with or without a browser
User-Agent. A poll now tries each feed four times with backoff, and a channel is
only painted as failed after `FEED_FAILURE_GRACE` consecutive polls fail. Old
sticky errors in `subscriptions.json` clear themselves on the next good poll.
A 404 from this endpoint means nothing about the channel; don't reintroduce
"404 = deleted" logic.

## 2026-07-30i: 023 built and installed to the vault

Note: the 023 build had never been copied into the vault — `./install.sh`, not
`npm run build`, is what puts a change on screen. Run it after every change.
Save now drops the card out of the Inbox the moment it is pressed (via
`dropIfFiltered`, so Kept keeps it).

## 2026-07-30h: 023 built — the cards have controls now

Stage one of the card-controls scope: **383 unit tests pass, build clean.**
Everything in [issues/023-card-controls-layout.md](issues/023-card-controls-layout.md)
is written and typechecked; none of it has been seen on a screen yet, and the
manual test in that issue is the next thing to run.

- **One card definition, two lists.** `HubView.buildCard` takes facts, not
  objects — it has never heard of `HubItem` or `SearchResult` — and both
  `renderCard` and `renderResult` go through it. What differs between the two
  surfaces is the four `run` handlers; what differs between the two platforms
  is the stylesheet.
- **The no-reflow machinery is in the CSS, not in the code.** Idle, working and
  done are three layers in one grid cell swapped with `visibility`; the border
  is present in every state; done is a checkmark with no label. A button
  therefore cannot change its own size, so nothing it does can move a
  neighbour. This is the rule most at risk from a later "just add a label"
  change — see `.ytfree-card-act`.
- **`openItem` is now `createNote` + open.** `saveItem` is the create half.
  Kept still means exactly what it meant (a note exists), so no state was
  added.
- **What is deliberately not done**, both written up in the issue: Hidden is
  still text rows (a tombstone has no thumbnail), and Preview has no player
  (stage three).
- **Stage two is next**: the persistent search blocklist, the `⋯` Hide-channel
  chip on search thumbnails, and the Settings lists that undo both. The
  session-only `removedResults` set in `hub.ts` is the seam it plugs into.

## Previous — 2026-07-30g: 022 complete, pending BarkernotBob's ears

Workstreams 5, 6 and 7. **375 unit tests pass, build clean, all seven
workstreams landed.** What is left is the four acceptance criteria that need a
person listening — they are written up as the Manual test in the issue.

- **Old maps are retired.** `SilenceMap.wordTimed` is what makes this safe: it
  tells a transcript map with no `words` (human-written track, legitimately no
  word timing, must never be refetched again) apart from a map written before
  022 (event-gap producer, found nothing at all on an auto-caption track).
  Absence → stale. Same shape as `noiseDb` on the ffmpeg side. State version 3,
  though the normalizer has always migrated by shape rather than by number.
- **`pruneWordLists`** keeps `words` on the 30 most recently computed videos and
  strips it from the rest on every write. Word lists are ~30 KB against a map's
  few hundred bytes, and this file syncs through iCloud on every write. It
  leaves `wordTimed` behind on purpose — otherwise pruning would make every old
  video look pre-022 and refetch the lot.
- **Minimum pause now floors at 0.4 s** (`MIN_SILENCE_GAP`), and `loadSettings`
  moves anyone sitting on the old 0.2/0.3 up to it. Below 0.4 s a "pause" is a
  breath inside a sentence, and the map fills with fragments shorter than
  `MIN_SKIP_SECONDS` — which is what step 1 stopped playing fast.
- **The reported failure is a fixture.**
  `tests/fixtures/silence-jlIDooGWXh0-278s.json` holds the real −30 dB
  silencedetect output for 258–286 s alongside the 79 word instants in it.
  Three of its four windows contain a spoken word; one test asserts that
  (so a bad regeneration can't quietly void the others) and the rest assert no
  skip window may contain a word at any reachable setting.
- **Clamp path verified end to end.** No gated YouTube video found, so gated
  audio was made from this one (`agate=threshold=0.02:ratio=9000`). Calibration
  reads floor −68.0 / speech −7.9 and picks −60 dB; silencedetect at −60 dB
  finds 13 silences in that minute against 15 at −30. Costs almost nothing.

**The thing to say to BarkernotBob before he tests.** The savings are small — about
7 s skipped plus 16 s at 3× across 26 minutes — and that is the right answer.
The old map's 138 seconds of "silence" was 112 windows with words inside them.
This video's word gaps are median 0.24 s, p95 0.88 s, longest 2.00 s. There was
never much to skip; the old version was skipping speech.

## Previous — 2026-07-30f: 022 step 4 — the threshold is measured, not chosen

Workstream 3, plus the ffmpeg half of 6 and the Advanced half of 5, because the
calibration is worthless while old −30 dB maps survive and had nowhere to put
its dials. **368 unit tests pass, build clean.**

`calibrateThreshold` (desktop, `src/desktop/calibrate.ts`) runs ffmpeg `astats`
over the first 60 s, once per video per run, and hands one threshold to every
chunk. The decision is `pickThreshold` in `silence.ts`, pure and tested without
ffmpeg installed: `min(floor + 8, speech − 20)`, clamped to [−60, −25], floor =
p5, speech = p90.

**Deviation from the issue, with the measurement behind it.** The issue says to
read the floor off `astats` **RMS_level**. That was tried first and it does not
work: `silencedetect` compares *individual samples* to its threshold, so an RMS
series over the same window sits systematically below what the detector reacts
to. On `jlIDooGWXh0` the RMS formula produces −48.5 dB, and −48.5 dB finds
**4 silences in 26 minutes**. Reading **Peak_level** instead — the same quantity
silencedetect is looking at — gives −36.1 dB from the issue's own defaults, and
that is where ffmpeg starts contributing real windows again. Measured at four
points in the video (0 s / 255 s / 600 s / 1200 s) the answer is stable to
0.5 dB: floor p5 −44.1/−44.0/−43.6/−44.0, speech p90 −9.9/−7.8/−9.4/−10.4.

Threshold vs. truth on that video, where "bad" = an ffmpeg window with a spoken
word inside it:

| threshold | raw windows | bad | skip s after veto | speed s |
|---|---|---|---|---|
| −30 (the old fixed default) | 209 | **112** | 13 | 10 |
| −36 (**calibrated**) | 138 | 64 | 7 | 16 |
| −40 | 74 | 26 | 4 | 23 |
| −45 (fallback) | 19 | 6 | 2 | 29 |

Two things worth saying plainly about that table. The **veto is what makes any
of these safe** — it removes every bad window at every threshold; calibration is
defence in depth and is what protects a video with no captions, where there are
no words to veto with. And **the honest total is small**: about 7 s skipped plus
16 s played at 3× across 26 minutes. That is not the calibration under-reaching,
it is what this video actually contains — the word-gap distribution is median
0.24 s, p95 0.88 s, max 2.00 s. The old −30 dB map's 138 seconds of "silence"
was mostly speech, so the correct fix necessarily skips less.

- **Migration (WS6, ffmpeg half).** `isStale` now also rejects an ffmpeg map
  with no `noiseDb`: every such map was built at the broken −30 and is wrong
  rather than coarse. A stored map whose `noiseDb` differs from this run's is
  not resumed either — its windows and the incoming ones would disagree about
  what silence is — so the video restarts from zero.
- **Settings (WS5, Advanced half).** `silenceNoiseDb` is no longer a front-page
  slider with a wrong default; it is `number | null`, blank = measured, in a
  collapsed **Advanced** `<details>` alongside floor margin (2–20, default 8)
  and word protection (0–0.5 s, default 0.2), under the warning "These trade
  accuracy for aggressiveness. Raising them can clip or skip real speech."
- Calibration never throws. A failure falls back to **−45 dB** and says so in
  the console; a test asserts it can never fall back to −30.
- 45 s timeout on the measurement, because it gates the analysis it precedes and
  a stalled network read would otherwise hang Smart Speed rather than degrade it.

Still open: the transcript half of WS6 (a stored transcript map from before this
issue has no `words`, and nothing forces a refetch), `pruneWordLists`, the
front-page settings tidy, WS7 fixtures, and the Manual test section in the issue.

## Previous — 2026-07-30e: 022 step 3 — words veto silence

Workstream 4. **353 unit tests pass, build clean.** With steps 1–3 in, the two
reported symptoms are both addressed before calibration has even landed.

`vetoWords(windows, words, pad)` subtracts every spoken instant, padded by
`silenceWordPad` (0.2 s), out of the windows about to be **skipped**. It runs
inside `combineSilence` on all three routes out of it — no-ffmpeg, union, and
music-skipping-off — so it covers stored maps, live ffmpeg batches, and an
ffmpeg map a Mac wrote and a phone read through iCloud, in one place.
Instrumentals are left alone: a `speed` window is played, not cut.

- Fragments under `MIN_SKIP_SECONDS` are dropped, because since step 1 the
  player does nothing with them and a map that still listed them would be lying.
- Linear in both lists, with a guard test: it runs on every batch of an ffmpeg
  analysis and a long video has thousands of each.
- `words` comes from `rawMapFor`, not `mapFor`. A caption map built at a coarser
  floor than the setting now asks for can't answer for windows, but its word
  instants are true at any floor — dropping them would disable the veto exactly
  when the user had just made the map more aggressive.

Known gap, closing in step 5: a stored transcript map from before this issue has
no `words`, and nothing yet forces a refetch to get them.

## Previous — 2026-07-30d: 022 step 2 — the transcript producer reads words

Workstream 1. **342 unit tests pass, build clean.**

`parseJson3Timed` now keeps `segs[].tOffsetMs` as `TimedCue.words` — absolute
instants, one per spoken word. Measured against the real caption file for
`jlIDooGWXh0` (`yt-dlp --write-auto-subs --sub-format json3`):

| | |
|---|---|
| caption events with text | 630 |
| word instants | 4324 |
| windows from **event gaps** @0.5 s | **0** |
| windows from **word gaps** @0.5 s | **97** (70.6 s of silence) |

That zero is the issue's claim reproduced: an auto-caption event states how long
a line is *on screen*, so consecutive events overlap and the producer found
nothing at all on this video.

- `windowsFromWords` emits `[word + WORD_ALLOWANCE, nextWord]`. `WORD_ALLOWANCE`
  (0.5 s) stands in for the word length json3 does not state, which is what
  makes tier 0 conservative by construction: two word starts must be a full
  second apart before anything is skipped at a 0.5 s floor.
- **The event-gap producer is kept, not deleted** — a deliberate departure from
  the issue text. A human-written track has no word timing, so the word producer
  would see one "word" per line and call every spoken line a pause. That is the
  worst failure this feature has. `transcriptWindows` picks: word instants
  outnumber cues → words, otherwise event gaps.
- Raw intervals stop *at* the next word, not `LEAD_OUT` short of it. Trimming is
  the apply layer's job and doing it twice would be an undocumented margin.
- `SilenceMap.words` persists them (2 dp; ~30 KB for this 26-minute video).
  Stored rather than recomputed because the veto has to run against a map that
  came off disk — the reported bug is a *stored* ffmpeg map skipping "3." on a
  second viewing.

## Previous — 2026-07-30c: 022 step 1 — Smart Speed can no longer speed up speech

[issues/022](issues/022-adaptive-silence-floor.md) workstream 2, the smallest and
first of the suggested order. **336 unit tests pass, build clean.**

The fast rate now has exactly one route to it: a window `combineSilence`
positively classified as `action: "speed"` — ffmpeg heard audio there *and* the
captions say no words were spoken, i.e. an instrumental. Every other outcome in
`moveFor` hands back the base rate:

- **Window remnant under `MIN_SKIP_SECONDS` → base rate**, was the fast rate.
  This is BarkernotBob's chipmunked *"and his name,"*: window 265.32–266.02 trimmed by
  the lead-in/lead-out margins to 0.30 s, under the 0.35 s floor, so `moveFor`
  fell through to 3× — on speech, because the −30 dB threshold had mis-detected
  it in the first place.
- **A skip the player vetoes → base rate.** Already correct (`{kind:"skip"}`
  carries `baseRate`), now covered by a named test so it stays that way, and the
  stale comment in `smartFrame` that claimed otherwise is fixed.

Detection is still wrong at this step — words still get *swallowed*; that is
workstreams 1/3/4. What has gone is the audible artifact on top of it.

## Previous — 2026-07-30b: section buttons fold the video on a second tap

Notes / Description / Transcript now do double duty. `jumpToSection(file, section,
videoId)` in `main.ts` first asks `inSection()` whether the reader is already there —
cursor inside the section's line range in source mode, else `lastJump` (the same button
pressed twice) in reading mode. If so it skips the scroll and calls `toggleHeaderFor()`,
which collapses the docked/pinned player (or restores it on the next tap) via the
existing `setCollapsed`. Unlike the collapse control it does **not** pause: the ask was
reading room, not silence. 331 tests pass, build clean. Not yet checked on the phone.

## Status — 2026-07-30: a way back, a line that lines up, a Play button that can't lie

[issues/021](issues/021-restore-pill-seek-drag-pending-play.md) is built and installed.
**331 unit tests pass, build clean.** Five items.

**1. A `Player` pill brings the pinned player back.** The pin that hides it lives on the
bar the pinned player carries, so hiding it left the command palette as the only route
back. `syncPinRestore(view, wanted)` in `main.ts` mounts a `button.ytfree-pin-restore`
into `view.contentEl` on any note whose frontmatter has a video, only while the pinned
player is off, and puts `ytfree-has-pin-restore` on the same element to give it a
positioning context. `.view-content` does not scroll (its CM scroller does), so the pill
holds the corner and costs the note no height — harness `textMoved: 0` on both shapes,
`outsideView: 0`, 30 pt clear of the phone's floating header, 34 pt tall there / 26 on
desktop. Cleaned up on view close, on toggle-on and in `onunload`.

**2. The timestamp button is gone** from the bar, and `insertTimestampFromButton` with
it. Auto-stamping and the **Insert timestamp** command are untouched; three settings
descriptions now point at them.

**3. The purple line is inset 16 px each side.** Measured, not guessed: Chromium's
`-webkit-media-controls-timeline` was screenshotted at 400/640/900 px and the pixels
counted — 16 px each end at every width, not a percentage. `.ytfree-progress` uses
`--ytfree-progress-inset` (default 16px) so a platform that differs is one variable
away. Harness: `progressInset [16, 16]`, `progressBelowPicture 0`, four widths plus
both immersive landscapes.

**4. Horizontal drag over the picture seeks, on mobile.** Obsidian's swipe recognizer
(`Vm` in `app.js`) walks up from the touch target and abandons the gesture at the first
element with `dataset.ignoreSwipe` — its own canvas does this. The mobile wrapper now
sets `data-ignore-swipe="true"`, and `bindDragSeek` in `player.ts` puts the movement to
use: picture width = 90 s, previewed on the purple line plus a centred `.ytfree-seek`
readout, committed once on `touchend`. Claims the gesture only past 12 px and only when
|dx| > |dy|; ignores multi-touch, a zero duration, and the bottom 56 px where the native
scrubber is. `touch-action: pan-y` keeps vertical scrolling. Desktop unaffected.

**5. Play can no longer show "playing" while nothing plays.** Spec-level cause:
`play()` on a sourceless element sets `paused = false`, rejects its promise, fires no
`pause`, and a later `load()` does not reset it while `readyState` is HAVE_NOTHING — so
the button, painted from the element's events, stuck. `play()` now checks `hasSource`
and otherwise records `pendingPlay`: pause icon, `is-waiting` pulse, label *Starting…
tap again to cancel*. Honoured in `attach`'s resume, `loadLocal`'s loadedmetadata and
`swapToLocal`; cleared by a second tap, by `pause()`, by `recover()`'s catch and by
`deferMobileLoad`'s failure branch.

Not yet confirmed on hardware: all five. The drag-seek and the pill are phone-shaped
and only the harness has seen them.

## Previous — 2026-07-30: the line where you can see it, and a bar you can read

[issues/020](issues/020-controls-tidy-immersive-landscape.md) is built and installed.
**331 unit tests pass, build clean.** Seven items; two of them are 019 not working on
the device it was written for.

**1. The desktop purple line was drawn in the wrong box.** `buildPlayer` passed
`mediaHost: media`, and on the desktop `media` *is* the whole wrapper — so the stage
wrapped the video *and* the section links and the line landed inches below the picture.
Desktop now passes `undefined` and gets the `.ytfree-stage` 019 claimed it had; mobile
still passes its own media box. Harness: 0 pt between picture bottom and line, both
shapes.

**2. Landscape sets immersive mode, not fullscreen.** iOS refuses
`webkitEnterFullscreen` outside a user gesture and a rotation is not one — the call was
made and silently dropped. `setImmersive()` instead puts `is-immersive` on the wrapper:
`position: fixed`, inset 0, picture letterboxed to the screen, controls on a dark strip,
sections hidden, `body.ytfree-immersive-open` locking scroll. CSS on the element that
already holds the playing `<video>`, so nothing is reparented and the buffer survives.
`enterFullscreen()` falls back to it 250 ms after WebKit ignores the request. Escape
leaves it (pop-out first); `destroy()` clears the body class. Measured at 844×390 and
667×375: covers the screen, full-width picture, controls on screen.

**3. `.ytfree-controls-side:last-child` had stopped matching** the day the pop-out panel
became the bar's last child — the right group had been `flex-start` ever since (desktop
slack 110/16). Groups are named now: `ytfree-controls-left` / `-right`, in player, base
CSS and the 460 px query. Four widths: overflow 0, `playOffCentre` 0, `offCentreVertical`
0, smallest target 40 pt, smallest gap 8 pt, nothing moves when the panel opens.

**4. Smart Speed left the bar for the pop-out.** Zap button and its badge deleted; the
switch in the panel is the only control, with the saved time beside its label. The
pop-out's button paints purple (`.is-smart`) when Smart Speed is on for the video. PiP
and Fullscreen moved to the left group to balance the sides.

**5. A pin button** on the right, sharing `togglePinnedPlayer()` with the command;
purple while on; the toggle is deferred a tick because it rebuilds the player the button
lives in. `setPinned()` repaints any surviving bar when the command is used instead.

**6. *Resume after* is a seconds slider** (0.25–5, quarter steps) with a live
description; storage is still ms, so no setting moves.

**7. *Pause while typing* is in the pop-out, per video** — `entry.pauseWhileTyping`,
falling back to the setting; the panel footnote says *This video only*, and a new
**All YT Free settings…** link opens the tab for the global default.

Not yet confirmed on hardware: the desktop line and the landscape immersive view.
Known trade-off: on a short phone the panel is taller than the room above the bar
(284 vs ~250 pt), so it scrolls under a JS-computed `max-height` rather than growing.

## Previous — 2026-07-30: descriptions are escaped before they reach a note

**331 unit tests pass, build clean, installed to the vault.**

A YouTube description is plain text that has never been markdown, and it was being
pasted straight under `# Video Description`. Smarter Every Day separates its sections
with `~~~~~~~~`, which markdown reads as a fenced code block — in *TALKING BACKWARDS
… 168* it opened one and the rest of the note, headings and transcript included,
rendered as code. `escapeDescription` in `src/description.ts` backslash-escapes the
line shapes that carry structure: `~~~`/``` fences (character by character, so no `~~`
strikethrough pair is left behind), leading `#`, setext `---`/`===`, `>`, and `[[`.
Lists are deliberately left alone. `buildWatchLaterNote` is the only write path, and
it escapes before it linkifies.

Still open: `templates/webclipper-ytfree.json` inserts the same raw description and has
no escaping filter available — the nearest fix there is a `|blockquote` filter, which
changes how the description looks. Existing notes are not rewritten.

## Previous — 2026-07-30: a line, a rotation, and the dials in the player

[issues/019](issues/019-progress-bar-landscape-quick-panel.md) is built and installed.
**328 unit tests pass, build clean.** Four items, one of which corrects 017.

**1. The tidy asks one question now: is there anything under `# Notes`?** 017's other
three conditions could each keep a note nobody had written in — a tag (the plugin writes
the frontmatter), anything above the first heading (which is where **Most replayed**
goes, so every note with a heatmap was permanently safe), and the file's mtime (the
plugin writes to these notes itself; a transcript fetched a fortnight later reset the
month). `hasWriting` reads the Notes section and nothing else; `TidyCandidate` lost
`tagged` and `modifiedAt`. The one uncertainty still answers "keep": no `# Notes`
heading, no judgement. Test count went 329 → 328 because two cases became one better one.

**2. A purple line along the foot of the picture.** Lives in the media box, not the
column — mobile had one, the desktop now gets a bare `.ytfree-stage` that is exactly the
video's size — so it costs the note no height. `transform: scaleX()`, never `width`;
`pointer-events: none`; repainted on `seeked` as well as `timeupdate`, because a Smart
Speed skip moves the position without playing through it. Fullscreen hides it for free:
fullscreen is requested on the `<video>`, and a sibling of the fullscreen element is not
rendered.

**3. Landscape → fullscreen, phones only, and it may not fire.** `Platform.isPhone` plus
an `(orientation: landscape)` media query, acting only on a player that has actually
played. iOS may refuse a fullscreen request with no user gesture behind it and a rotation
is not one, so `enterFullscreen` fails silently by design — the worst case is that
nothing happens. **Step 4 of 019's manual test is what settles it**; ask for the answer
before assuming this item is closed.

**4. Two more buttons under the video.** A gear that opens the plugin's settings tab
(`app.setting`, internal, guarded), and a pop-out of per-video dials: Smart Speed, Skip
music too, pause speed, shortest pause, player size. **None of them writes a setting** —
`PlayerEntry.skipNonSpeech` is a per-player override, the height is set on the wrapper's
CSS variable, and both die with the note. The panel is built at construction, hidden with
`visibility`, and absolutely positioned off the control row;
`tools/controls-harness.mjs` now measures the bar open and shut and reports 0 growth at
375 / 390 / 430 / 700 pt, with no overflow and 8 pt between every target.

**Next:** BarkernotBob's manual tests for 017 (step 9, the lock screen) and 019 (step 4, the
rotation), and [issues/018](issues/018-watch-later.md)'s open question, which is still a
decision rather than code.

## Previous — 2026-07-30: silence is skipped, and notes clean up after themselves

[issues/017](issues/017-skip-fold-tidy.md) is built. **329 unit tests pass, build clean.**
Six items off BarkernotBob's list; five landed, one is half-landed and the missing half is not
ours to write.

**1. Silence is seeked over, not sped through.** A window now carries an `action`.
`speed` means "a caption gap ffmpeg analysed and found *audible*" — an instrumental, which
must not be cut. `skip` is everything else, including every window on a phone (no ffmpeg)
and everything past ffmpeg's frontier. Two vetoes fall back to the old fast-forward: under
`MIN_SKIP_SECONDS` (0.35 s) left in the window, or a target `video.buffered` does not
cover — a seek past the buffer is a spinner, which is worse than the pause. All of it is
in `moveFor`, which is pure; `player.ts` only applies the answer.

**2. The tidy is the one to be careful about.** A daily sweep trashes a video note when
four things hold: the video was played over a month ago, the file has not been edited
since, nothing is written in it (no `# Notes` body, no tags, nothing above the first
heading), and it is not open. Description and transcript sections are not read at all —
the plugin wrote them. Every uncertainty answers "keep". It goes through
`fileManager.trashFile`, never an outright delete, and logs every path. The month comes
from a **new `watched` map in `progress.json`**, deliberately separate from `positions`,
because a position is deleted the moment a video finishes and "you watched this" is
exactly the fact that has to survive that. **Nothing can be tidied yet** — the stamps
start empty today.

**3. Background audio is host-gated, and I could not verify the host.** Built:
`navigator.mediaSession` metadata and handlers, plus a real bug found on the way — a
hidden window gets no animation frames, so a screen lock mid-instrumental left
`playbackRate` at 3× with nothing awake to undo it (now handed back on
`visibilitychange`). Not built and not buildable from a plugin: the audio session /
background-audio entitlement that decides whether audio survives a lock at all. Step 9 of
017's manual test is what settles it — and the wording of BarkernotBob's answer matters, so ask
for it verbatim.

**Also:** the transcript now lands folded (`foldNewSections` is additive and retries,
because `vault.process` returns before the open editor catches up); opening a video note
by any route moves it out of the Inbox and the card leaves the list; and the pinned-height
slider works on a phone, with the docked media box taking a width ceiling from it so a
sideways phone cannot hand the whole screen to the video.

**Next:** [issues/018](issues/018-watch-later.md) is a written decision, not code — the
YouTube Watch Later import never drains, because nothing here writes to YouTube. It ends
in one question for BarkernotBob and does not proceed without it. Before that, 017's manual
test, especially steps 9 and 12.

## Previous — 2026-07-29: Smart Speed round two — union, chunks, ffmpeg installed

[issues/016](issues/016-smart-speed-round-two.md) is built and installed. **297 unit tests
pass, build clean.** ffmpeg 8.1.2 is now installed on this Mac
(`/opt/homebrew/bin/ffmpeg`, the first entry in `FFMPEG_CANDIDATES`, so auto-detect finds
it with no setting). Three things from BarkernotBob's first real session with 015, and they
turned out to be one change.

**1. He wants music skipped, which inverts 015's premise.** 015 sold ffmpeg on being able
to tell an interlude from a pause. BarkernotBob: *"Musical interludes should still be cut …
the idea is to let this get you straight to the content."* So the producers no longer
compete — caption timing answers "nobody is speaking", ffmpeg answers "nothing is
audible", and playback compresses the **union**. New setting **Skip non-speech audio**,
default on; off restores 015's behaviour. Say this plainly: with it on, **ffmpeg adds
much less than 015 claimed** on a captioned video. Its real value is now uncaptioned
videos and pauses inside a cue's own span.

**2. "Nothing is skipped with ffmpeg on" was a real bug, and the cause was the design.**
`setSilenceWindows` *replaces* the map, and the ffmpeg producer called it on every batch
with only what it had measured. A streamed googlevideo analysis runs at **1.9× realtime**
(measured: 300 s in 154 s, 1 % CPU — the connection is throttled, not the decoder), and
BarkernotBob watches at 4×, so the map only ever described video that had already played. The
complete 362-window caption map was being swapped out for it, batch by batch. Everything
now goes through `combineSilence`, where a partial ffmpeg map can only ever *add*.

**3. The fix for the speed is that the throttle is per connection.** Six parallel chunks
measured **~10×** against 1.9× for one stream. `detectSilenceChunked` runs a pool of six,
60 s chunks with 3 s overlap, ordered **outward from the playhead**. Two traps, both
handled and both tested: silencedetect reports timestamps **relative to `-ss`** (a wrong
offset yields a completely plausible wrong map — `spikes/silence-chunks/run.mjs` is the
end-to-end check, and matched 27/27 windows against a single-stream run), and a pause on
a chunk boundary would be split into two sub-threshold halves without the overlap.

**Also:** `silence-maps.json` is **version 2** — one entry per video holding a map per
source, each with its own `minGap`/`computedAt` and, for ffmpeg, `analyzedTo`. v1 files
migrate on read and lose nothing, which matters because the phone will keep writing v1
until it syncs. `analyzedTo` also fixes a 015 bug found while reading: a cancel *resolves*
`done`, so a note closed twenty seconds in recorded its stub as a complete map and
answered for that video forever. And `LEAD_OUT_SECONDS` 0.1 → 0.25, for BarkernotBob's *"it
slightly cuts into the speaking right before it slows back down."*

**Next:** the manual test in [issues/016](issues/016-smart-speed-round-two.md). Step 8 is
the one that decides everything — it is a console line proving ffmpeg is reached at all.
No ffmpeg map has *ever* been written on this machine, so it is still possible the
producer is failing before it starts and the caption map has been doing all the work.
015's own manual test, and 012–014's, are still outstanding.

## Previous — 2026-07-29: Smart Speed built, not yet tested on a device

[issues/015](issues/015-smart-speed.md) is **code-complete**. **281 unit tests
pass, `tsc` clean, build clean** (including the mobile eager-`require` guard).
Not yet installed to the vault and not yet run on hardware — the manual test in
the issue file is the exact next step.

**Shape:** producers make a *silence map* (sorted `[start, end]` windows), one
apply layer in `player.ts` consumes it and never knows which producer fed it.

- `src/silence.ts` — the whole pure core: gap→window builder, margin trimming,
  binary-search lookup, rate decision, time-saved, staleness, map arbitration
  and merge, ffmpeg stderr parser. No DOM, no Node, no platform. 40 tests.
- `src/silence-store.ts` — `silence-maps.json`, **merge-on-save** (014's lesson:
  two devices write this file, so re-read then union inside the write chain).
- `src/transcript.ts` — new `parseJson3Timed` keeps the per-cue durations the
  old parser threw away; `parseJson3` is now a projection of it, unchanged.
- `src/desktop/silencedetect.ts` — ffmpeg producer, desktop-only, spawns on the
  **audio-only** URL (~1 MB/min via the new `resolveAudioUrl`), parses stderr
  progressively and feeds the live player, SIGKILL on close.
- `src/player.ts` — rAF engine (timeupdate at ~250 ms is too coarse),
  `preservesPitch` on every path a `<video>` can be created or swapped, toggle
  in the left control group with the time-saved readout as an absolutely
  positioned badge inside it.
- `src/main.ts` — stored map applies instantly on mount (free); producers fire
  on first `play` (so merely opening a note costs no caption fetch).

**Three deliberate deviations from the scope doc**, all recorded at the top of
[docs/V1-SCOPE-SMART-SPEED.md](docs/V1-SCOPE-SMART-SPEED.md): one shared
"shortest pause to skip" setting drives both the caption producer and ffmpeg's
`d=` (BarkernotBob's call); maps store raw windows and the live setting filters at
playback, so raising the threshold needs no recompute; and the doc's
time-saved formula was arithmetically wrong and was replaced.

**One layout change worth knowing about:** Smart Speed is a ninth control and
the single-row bar was already spending 340 of the 347pt a docked 375pt phone
has. Rather than shrink targets back to the 36pt that caused the fat-fingering
this codebase already fixed once, **below 460pt the control bar is now two
rows** — transport centred on top, side controls beneath. Targets stay 40pt,
gaps stay 8pt, Play is dead-centre, `tools/controls-harness.mjs` reports
overflow 0 at 375/390/430/700. The cost is ~48px of vertical chrome on phones.
If BarkernotBob dislikes it, the alternatives are dropping a control on mobile or
going back to 36pt targets.

**Next:** `./install.sh`, then the manual test in
[issues/015](issues/015-smart-speed.md) — steps 5 (nothing moves) and 8 (phone
works with nothing installed) are the ones that decide it. The 012, 013 and 014
manual tests are still outstanding.

## Previous — 2026-07-29: Smart Speed scoped

[issues/015](issues/015-smart-speed.md) scoped and approved for build, doc at
[docs/V1-SCOPE-SMART-SPEED.md](docs/V1-SCOPE-SMART-SPEED.md). Hard constraint:
works with zero dependencies (caption-gap maps, both platforms); ffmpeg only
*upgrades* accuracy when found. Web Audio real-time route measured closed
(googlevideo CORS is origin-whitelisted). The issues/README index also got its
missing 010–014 rows.

## Previous — 2026-07-29: hidden videos stopped coming back

Built and installed. **240 unit tests pass, build clean.**
[issues/014](issues/014-hidden-videos-came-back.md) is the issue and holds the
manual test, which needs both devices.

BarkernotBob hid a batch of videos on the phone and they reappeared. **Cause:**
`subscriptions.json` is one blob synced by iCloud, read once at plugin load and
written back **whole** on every save — so the last device to save won the entire
file. The Mac polls every few minutes from a snapshot loaded when its Obsidian
started; that save erased the phone's hides, and iCloud carried the erasure
back. Not caused by 012 or 013 — no code there touches item state — but this
week's two-device testing is what made a latent bug routine.

**Not recoverable.** The state file is gitignored (`.obsidian/plugins/*/*`) and
there are no local Time Machine snapshots. The 7 surviving tombstones all
predate `dismissedAt`, which is itself the evidence. Those hides have to be
made again once.

**The fix — a save is a merge, not an overwrite:**

- `HubItem.decidedAt`, stamped by `hideItem` / `keepItem` / `restoreItem`.
- `mergeStates(mine, theirs)` in `subscriptions.ts` — pure. Newer decision wins
  per video; facts (description, duration, `isShort`, earlier `seenAt`) are
  pooled from both sides; a tombstone never gets its description back; on a tie
  a decision beats no decision and Kept beats Dismissed.
- `save()` re-reads the file and merges into it. One extra read per save.
- `refreshFromDisk()` — stat, read only if moved — on hub open and before every
  poll, so a long-running window stops merging against a stale copy.
- `removeChannel` leaves a `removedChannels` tombstone, or a union would hand a
  removed channel straight back.
- **`SubscriptionsStore.live(item)`**: a merge rebuilds item objects, so a card
  rendered earlier holds an orphan. Every mutation resolves by video ID first —
  `hide`, `restore`, `openItem`, `backfillDurations`. This hazard came *from*
  the fix; without it the fix would have dropped clicks.

**The guarantee BarkernotBob asked for:** `tests/merge.test.ts`, 20 scenario-shaped
regression tests ("the Mac's stale poll cannot un-hide what the phone just
hid"), **and `install.sh` now runs `npm run check` instead of `npm run build`**
— nothing reaches the vault unless the suite passes. The tests are only worth
anything because they now run on every install.

**Next:** the both-devices manual test in issues/014. Steps 4 and 6 are the ones
that used to fail. The 012 and 013 manual tests are still outstanding.

---

## Status — 2026-07-29: most-replayed on the phone, and backfilled

Built and installed. **220 unit tests pass, build clean, live smoke 11/11.**
[issues/013](issues/013-heatmap-on-the-phone.md) is the issue and holds the
manual test. BarkernotBob asked for the top moments on mobile *or* an automatic
backfill with no command; this is both.

- **012's stated limitation was wrong and is retracted.** The heatmap is not
  yt-dlp-only. It is in InnerTube's `next` response under
  `frameworkUpdates.entityBatchUpdate.mutations[].payload.macroMarkersListEntity.markersList`
  where `markerType === "MARKER_TYPE_HEATMAP"` — I had looked for `heatMarker`,
  the old renderer name. Probed live: **WEB is the only client that answers**
  (1.0 MB / 100 markers; ANDROID 13 MB and IOS 11 MB for the same 100; MWEB,
  TVHTML5, ANDROID_VR, WEB_EMBEDDED_PLAYER none; the `player` endpoint none on
  any client). 1 MB decompressed is **67,204 bytes on the wire**, measured, once
  per note — which is the number to judge it by on a phone.
- **New:** `CLIENTS.web` + `NEXT_URL` (`innertube-context.ts`),
  `fetchHeatmap()` (`innertube.ts`), `parseHeatmapMarkers()` and
  `parseTranscriptCues()` (`transcript.ts`), an `anchor` argument on
  `upsertSection`, `queueHeatmapBackfill`/`backfillHeatmap` (`main.ts`).
- **The fetch:** `harvestWithInnertube` runs captions and heatmap in parallel
  and swallows a heatmap failure — peaks are the garnish, the transcript is the
  meal. The command is one name on both platforms again.
- **The backfill:** on `file-open`, a video note with a transcript and no
  most-replayed section gets one request and, if there are peaks, the section —
  above the transcript, labelled from the note's own transcript rather than a
  second caption download. Silent otherwise. "Already checked" is in memory
  only, so an obscure video costs one 67 KB request per session you open it;
  the alternative was churn in a synced file.
- The UA is part of the identity: a WEB context with an iPhone UA gets MWEB's
  answer, which has no heatmap. Both live together in `CLIENTS.web`.

**Next:** the manual test in issues/013 — steps 1–2 (a phone note gets peaks by
itself) and 4–5 (an old note backfills once, then stays quiet) are the deciding
ones. The 012 manual test is still outstanding too.

---

## Status — 2026-07-29: resume, phone transcripts, a row you can hit

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
   (This entry also claimed **most-replayed stays desktop-only** — wrong, and
   retracted the same day. See the 013 entry above.)
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
