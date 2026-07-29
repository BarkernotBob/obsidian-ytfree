# 015 — Smart Speed: compress pauses like Overcast

Status: **Built 2026-07-29 — awaiting BarkernotBob's manual test.** Scope and design decisions
live in [docs/V1-SCOPE-SMART-SPEED.md](../docs/V1-SCOPE-SMART-SPEED.md), including three
recorded deviations from the original scope (one shared pause-length setting instead of
two, raw windows filtered at playback, corrected time-saved formula).

Code: `src/silence.ts` (pure core), `src/silence-store.ts` (merge-on-save persistence),
`src/desktop/silencedetect.ts` (ffmpeg producer), apply layer in `src/player.ts`, wiring
and settings in `src/main.ts`, 40 tests in `tests/silence.test.ts`.

BarkernotBob: *"Research what I could do to implement a smart speed like in Overcast …
I want it to be usable without downloading anything further like ffmpeg, but then
that's an addition that adds features. But if FFMPEG is required for use, that's
a no go."*

## The one-paragraph version

Pauses in speech play at ~3×, speech plays at the chosen speed, pitch stays
normal. One engine in the player consumes a **silence map** (windows of
`[start, end]` seconds); three interchangeable producers make maps: caption-gap
timing (no dependencies, desktop **and** mobile — this is the baseline a
stranger gets), ffmpeg `silencedetect` on the audio-only stream (desktop, only
if ffmpeg is found, more accurate, streams — nothing downloads to disk), and
maps synced from the other device through the vault. The real-time Web Audio
route is closed — googlevideo only grants CORS to youtube.com, measured
2026-07-29 — which is why maps, not live analysis.

## Build order

1. Apply layer in `player.ts` + rate decision function + toggle & time-saved
   readout (space reserved — no layout reflow).
2. Transcript producer: keep json3 durations (`dMs`) the parser currently
   discards; gaps > 0.5 s → windows with entry/exit margins baked in.
3. Map store `silence-maps.json` — save is a merge (014's lesson), union by
   video ID, ffmpeg beats transcript.
4. ffmpeg producer: resolver-style discovery, spawn on audio-only URL, parse
   stderr progressively, feed the live player, kill on close. Local downloads
   (002) analyzed directly.

## Acceptance criteria

1. Fresh vault, no ffmpeg, no yt-dlp: captioned video compresses pauses with
   normal pitch, time-saved climbs — desktop and iPhone.
2. Toggle off → engine never touches `playbackRate`.
3. ffmpeg installed → map upgrades mid-playback; quiet-music sections are not
   compressed.
4. No captions + no ffmpeg → toggle dims with an explanation, no errors.
5. Mac-computed map syncs to the phone and is used there.
6. Toggling moves no neighboring control.
7. Unit tests: stderr parser, gap→window builder, rate decision, map merge.

## Manual test (for BarkernotBob)

Roughly 15 minutes, and steps 6–8 need a wait for iCloud. Use a talking-head video with
captions — a podcast clip or a lecture, not music. Nothing here needs the terminal.

**Setup**

1. Run `./install.sh` in the project folder, then in Obsidian turn YT Free off and back
   on (Settings → Community plugins → the toggle next to YT Free).
2. Open Settings → YT Free. You should see a new **Smart Speed** section above
   **Transcript**, with four rows: Compress pauses, Pause speed, Shortest pause to skip,
   and — on the Mac only — Silence threshold (ffmpeg). Leave the defaults alone for now
   (on, 3×, 0.5 s).

**Does it work at all — Mac**

3. Open a note with a captioned video and press play. In the control bar, the lightning
   button next to the speed picker should be **coloured in** (on). Listen through a
   stretch where the speaker pauses between sentences: the pauses should whip past while
   the words themselves sound normal — *and not chipmunky*. If voices sound high-pitched,
   that's a bug, write it down.
4. After a minute or two, a small number like `−0:12` should appear tucked into the
   bottom-right of that same lightning button. It should only ever grow.
5. Tap the lightning button to turn it off. The colour goes away, playback returns to
   plain speed, and — the thing to actually watch for — **no other button moves, and the
   bar doesn't change size**. Tap it back on.

**Does the phone get the Mac's work — iPhone**

6. Still on the Mac, let that video play for a couple of minutes so its map is written,
   then close the note. Wait for iCloud to settle (a minute or two; the Obsidian sync
   dot going quiet is a good sign).
7. On the iPhone, open the same note. Press play. Pauses should compress **immediately**,
   from the first pause — no warm-up, because it is using the map the Mac computed.
8. Now open a *different* captioned video on the phone, one the Mac has never played. It
   should also compress pauses, just possibly a second or two after playback starts
   (the phone is fetching captions itself). This is the "works with nothing installed"
   case — the one that matters most.

**The phone's control bar (the layout change)**

9. On the iPhone, look at the control bar under the video. It is now **two rows**: play /
   skip-back / skip-forward centred on top, and the speed picker, lightning, picture-in-
   picture, fullscreen and collapse on the row below. Check that nothing is cut off at
   either edge, and that you can hit each button without hitting its neighbour. Try it
   in portrait and landscape.

**The setting you asked for**

10. Back on the Mac, Settings → YT Free → **Shortest pause to skip**, change it to
    **2 s**. Return to the video. Only long pauses should now be compressed — ordinary
    between-sentence breaths play normally, and the time-saved number climbs more slowly.
11. Change it to **0.2 s** and play again. Now almost every gap is compressed; it may
    feel too aggressive, which is the point of the setting. Put it back to 0.5 s.

**When it should politely do nothing**

12. Open a video with **no captions** (a music video is an easy one to find). The
    lightning button should be **greyed out and unclickable**, and hovering it on the
    Mac should say why. Nothing should error, and the video should play normally.
13. Open Obsidian's developer console on the Mac (View → Toggle Developer Tools) and
    scan for red errors while doing steps 3, 8 and 12. There should be none.

**If you have ffmpeg (skip if you don't — that's the whole point)**

14. Play a captioned video on the Mac and let it run 30 seconds. If ffmpeg is installed,
    the map silently upgrades mid-playback; hovering the lightning button should change
    from saying it's using *caption timing* to saying *measured audio*.
15. Find a video with a quiet musical interlude. With the ffmpeg upgrade in place, that
    interlude should **not** be sped through — quiet music is not silence. (With caption
    timing alone it will be; that's the known limitation.)

**What to report back:** which numbered step, what you expected, what happened. Step 5
(nothing moves) and step 8 (phone works alone) are the two I'd most want to hear about.
