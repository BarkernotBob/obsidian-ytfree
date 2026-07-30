# 022 — Adaptive silence floor: no chipmunks, no swallowed words

Status: **Planned 2026-07-30 — not started.**

> Smart speed is not working very well. […] "and his name," is being sped up
> chipmunk style. […] "3" is not being pronounced at all audibly but is being
> skipped over. Our requirement: Make this work like Overcast smart speed.
>
> Rather than find the speech then add a negative to it, can't we just measure
> 60 seconds and find the minimum, and consider that the floor, everything at
> that level or within a few db of it is "silence"?

---

## The diagnosis (verified 2026-07-30, video `jlIDooGWXh0`, "The Names of God")

Every reported artifact traces to **one root cause: the fixed
`silencedetect=noise=-30dB` threshold**, plus one playback rule that turns
detection errors into chipmunk. Evidence, so the implementing session does not
have to re-derive it:

- Measured **mean speech volume of this video is −24.8dB** — the −30dB floor
  sits ~5dB under *average* speech, so soft sentence-final words fall below it
  and are classified as silence.
- Stored ffmpeg window **277.94–278.99** contains the word **"3." spoken at
  278.32** (word-level caption timing). The skip seeked 278.09→278.74, jumping
  clean over "3." — the exact reported bug.
- Window **269.34–270.42** contains **"him." at 269.52** — same failure.
- Window **265.32–266.02** overlaps the tail of "name." (265.28) and the onset
  of "And" (266.00). After lead-in/out trim it is 0.30s — under
  `MIN_SKIP_SECONDS` — so `moveFor` fell back to **3× rate = the chipmunk**.
- The map has **354 windows** in this video (~one per 2s of runtime): the
  threshold is slicing through speech, not finding pauses.
- Threshold sweep on the same 25s clip: **−30dB → 5 "silences" (several
  containing words); −40dB → 1 (misses real pauses — room tone sits between
  −40 and −30); −45dB → 0.** No fixed number works: −30 over-detects and −40
  under-detects **on the same video**. Threshold must be per-video.
- The **transcript producer contributed 0 windows** for this video: json3
  *event* durations cover caption display time, not speech, so ≥0.5s gaps
  almost never appear between events. But the json3 we already fetch carries
  **per-word timestamps** (`segs[].tOffsetMs`) that `parseJson3Timed`
  (src/transcript.ts) currently ignores.

## Design principles

1. **Floor-anchored adaptive threshold** (BarkernotBob's ask): measure the audio,
   find its noise floor, call everything within a margin of that floor
   "silence". Not "speech minus a constant".
2. **Percentile, not minimum**: the floor is the ~5th percentile of
   short-window RMS over the calibration sample. A raw minimum is one lucky
   20ms sample.
3. **One safety clamp**: threshold must stay ≥ ~20dB below the speech band
   (high percentile of the same histogram). On normal audio the clamp never
   engages — it exists for gated/denoised audio whose digital floor is −90dB,
   where "floor + margin" would detect nothing. Both bands come from one
   histogram; no second pass.
4. **Words veto silence.** We have per-word timestamps for free. No skip
   window may contain a word timestamp. This catches every residual detection
   error and is pure, testable logic.
5. **Errors must fail silent, not audible.** Whenever playback is not confident
   enough to seek, it does **nothing** (base rate). The 3× fallback for short
   remnants is deleted — 3× is reserved for windows *positively classified* as
   instrumental (ffmpeg says audible + captions say no words). Chipmunk on
   music is the feature; chipmunk on speech is the bug.
6. **Stage capability by tier, keep safety at every tier.** The most basic
   user (phone, no ffmpeg) skips less but never hears an artifact. Desktop +
   ffmpeg skips more. Settings that could create false skips live behind an
   Advanced section with an explicit warning.

## Tiers

| Tier | Who | Producers | What gets compressed |
|---|---|---|---|
| 0 | Mobile, and desktop without ffmpeg | Word-level transcript gaps | Long, confident gaps between words (incl. music — BarkernotBob: fluff is skippable). Conservative pads. Skip only; never 3×. |
| 1 | Desktop + ffmpeg | Tier 0 **+** calibrated silencedetect | Union as today (issue 016 semantics), with word veto over every skip window; instrumental windows (audible per ffmpeg, wordless per captions) play at pause speed. |

A phone reading a Mac-written ffmpeg map through iCloud sync gets tier-1
windows with tier-0 playback rules — the word veto applies at combine time on
both platforms.

## Workstreams

### 1. Word-level transcript producer (tier 0 foundation)

- Extend `parseJson3Timed` (src/transcript.ts) to emit word instants from
  `segs[].tOffsetMs` alongside the current cue shape. json3 gives word
  *starts* only, not ends.
- New pure producer in src/silence.ts: a gap is
  `[wordStart_i + WORD_ALLOWANCE, wordStart_{i+1} − LEAD_OUT]`, kept only when
  `wordStart_{i+1} − wordStart_i ≥ minGap + WORD_ALLOWANCE`.
  `WORD_ALLOWANCE` (~0.5s) stands in for the unknown word duration — this is
  what keeps tier 0 conservative by construction.
- Replace the event-gap producer with this one (it currently produces nothing
  useful on auto-captions). Keep the `transcript` source name; see migration.

### 2. Playback: delete audible failure modes

In `moveFor` (src/silence.ts) and `smartFrame` (src/player.ts):

- Window remnant `< MIN_SKIP_SECONDS` → **base rate** (do nothing). Not 3×.
- Skip vetoed because target is unbuffered → **base rate**. Not 3×.
- `action: "speed"` (positively classified instrumental) keeps the 3×/pause
  speed — that behavior is correct and wanted.
- Existing lead-in/lead-out margins stay as-is; they handle boundary fuzz, not
  detection error, and the veto now handles detection error.

### 3. Calibration: floor-anchored threshold (tier 1)

New module beside src/desktop/silencedetect.ts:

- Run ffmpeg `astats` over the **first analysis chunk** (60s, same stream URL,
  before the worker pool starts):
  `-af astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level`
  with ~50–100ms analysis windows; parse the RMS series from stderr like
  silencedetect output is parsed today (pure text→numbers function).
- Pure function `pickThreshold(rmsLevels: number[])`:
  - `floor` = 5th percentile (ignore −inf / < −90 values when the floor band
    is digitally silent — treat as gated audio).
  - `speech` = 90th percentile.
  - `threshold = min(floor + FLOOR_MARGIN, speech − SPEECH_GUARD)`, clamped to
    `[-60, -25]` dB. Defaults: `FLOOR_MARGIN = 8`, `SPEECH_GUARD = 20`.
  - Returns the threshold **and** the two bands, for logging/diagnostics.
- If calibration fails (chunk unreadable), fall back to **−45dB** — the
  under-detecting direction. Never fall back to −30.
- Calibrate once per video per run; pass the result to every chunk. Store the
  threshold used on the map (new `noiseDb` field on `SilenceMap`).

### 4. Word veto at combine time

- New pure function in src/silence.ts: subtract padded word instants
  (±`WORD_PAD`, ~0.15–0.2s) from every **skip** window; windows shrink or
  split, and fragments below the minimum useful size drop. Runs inside/next to
  `combineSilence` so it applies to ffmpeg and transcript windows alike, on
  both platforms, and is unit-testable without a `<video>`.
- The instrumental classification (016's `subtractWindows(transcript, ffmpeg)`)
  now uses word-level gaps, which makes "audible + wordless = music" much more
  trustworthy.

### 5. Settings restaging + warnings

- **Remove** the fixed `silenceNoiseDb: -30` setting as a primary control.
- Normal settings (safe, tuned): Smart Speed on/off, Skip music on/off, pause
  speed, minimum silence (slider floor 0.4s).
- **Advanced** section, collapsed, with warning copy: *"These trade accuracy
  for aggressiveness. Raising them can clip or skip real speech."*
  - Floor margin (dB above measured floor), default 8.
  - Manual threshold override (dBFS) — blank = calibrated. Replaces the old
    setting for anyone who had changed it.
  - Word-veto pad, default 0.2s.
- Defaults must produce zero audible artifacts on the fixture video.

### 6. Staleness & migration

- `SilenceMap` gains `noiseDb` (ffmpeg maps) and a producer version for
  transcript maps. **Any stored ffmpeg map without `noiseDb` was built at the
  broken −30 fixed threshold → treat as stale, recompute.** Old event-gap
  transcript maps → stale likewise.
- Bump state to version 3 in normalize; v2 entries migrate by being marked
  stale, not dropped — the iCloud two-writer merge rules in silence-store.ts
  are untouched.

### 7. Tests & regression fixtures

- Check in fixtures from the real bug: the word list (or a trimmed slice) of
  `jlIDooGWXh0` + the broken stored map. Regression test: **after the full
  pipeline, no skip window contains 278.32 ("3."), 269.52 ("him."), or
  265.28/266.00 ("name."/"And")**.
- Unit tests for `pickThreshold`: normal bimodal audio, gated audio (−90dB
  floor → clamp engages), all-speech sample, all-silence sample.
- Unit tests for the word veto (split/shrink/drop) and the word-gap producer
  (allowance math, minGap interaction).
- Unit tests for `moveFor`: short remnant → base rate; unbuffered → base rate;
  instrumental → fast.
- Existing tests in tests/silence.test.ts and tests/transcript.test.ts must
  keep passing except where behavior intentionally changed (3× fallback).

## Suggested order

1. Workstream 2 (playback safety) — smallest, kills chipmunk immediately.
2. Workstream 1 (word-level parsing) — unblocks 4 and improves tier 0.
3. Workstream 4 (word veto) — with 1+2 done, swallowed words are gone even
   before calibration lands.
4. Workstream 3 (calibration) — the real fix; biggest single piece.
5. Workstreams 6, 5, 7 — migration, settings, then lock in fixtures.

Commit at each numbered step (working checkpoint), refresh HANDOFF.md.

## Acceptance criteria

- [ ] On `jlIDooGWXh0` at 1×, pause speed 3×, min silence 0.5s, smart speed +
      skip music on: "and his name" plays clean, "3" (278.3s) and "him."
      (269.5s) are audible. No chipmunked speech anywhere in minutes 3–6.
      → **Needs BarkernotBob's ears.** Proven against the data as far as it can be:
      the real −30 dB map for that passage is checked in as
      `tests/fixtures/silence-jlIDooGWXh0-278s.json`, and a test asserts no skip
      window may contain any of the 79 word instants in it, at every minimum
      pause the dropdown offers.
- [ ] Real inter-sentence pauses in the same stretch are still skipped
      (readout's saved-seconds counter advances). → **Needs BarkernotBob's eyes.**
      Measured expectation for the whole 26 minutes: ~7 s skipped outright plus
      ~16 s played at 3×. That is small, and it is what the video contains —
      see the note below.
- [ ] With ffmpeg removed from PATH: no errors, transcript-only maps skip long
      gaps, zero audible artifacts at default settings. → **Needs BarkernotBob.**
- [ ] On mobile: same as above (tier 0), and a Mac-computed map syncing in
      raises skip coverage without changing safety. → **Needs BarkernotBob.**
- [x] A gated-audio video (OBS/denoised mic) still gets silence detected
      (clamp path). No YouTube ID found; verified instead on gated audio made
      from this video (`agate=threshold=0.02:ratio=9000`), which is a stricter
      test of the same path. Calibration reads floor −68.0 / speech −7.9 and
      picks **−60 dB**; `silencedetect` at −60 dB finds 13 silences in that
      minute against 15 at −30 dB. The clamp holds and costs almost nothing.
- [x] Stored maps from before this issue are recomputed, not trusted. An ffmpeg
      map with no `noiseDb` and a transcript map with no `wordTimed` are both
      stale; a map whose `noiseDb` differs from this run's is not resumed.
- [x] Advanced settings show the false-skip warning; defaults untouched by it.

**One finding worth stating plainly.** The savings on this video are small — a
few percent — and that is the correct answer, not a shortfall. The old −30 dB
map claimed 138 seconds of "silence" in 26 minutes, and **112 of its 209
windows had a spoken word inside them**: most of that 138 seconds was speech.
What the video actually contains is short pauses (word gaps: median 0.24 s,
p95 0.88 s, longest 2.00 s). A Smart Speed that is honest about this video will
skip much less than the broken one did.

## Manual test (for BarkernotBob)

Do this on the Mac first, with ffmpeg installed. It takes about ten minutes.

**Before you start.** Settings → YT Free → Smart Speed: turn *Smart Speed* on,
*Skip music and other non-speech* on, *Pause playback speed* to 3×, *Shortest
pause to skip* to 0.5 s. Do not open **Advanced** — the point of the test is
that the defaults are right.

1. **Clear out the old maps.** Quit Obsidian. In Finder, open the vault folder,
   then `.obsidian/plugins/ytfree/`, and delete `silence-maps.json` if it is
   there. (You do not have to — the plugin throws the bad maps away by itself —
   but deleting it means what you hear next is definitely not an old map.)
   Reopen Obsidian.
2. **Open the video from the issue** — `jlIDooGWXh0` — and press play. Let it
   sit for about thirty seconds without touching anything; that is the audio
   being measured and analysed in the background.
3. **Listen to 4:15 → 4:45** (255 s to 285 s). This is the passage that was
   broken. You should hear, at normal speed and with nothing clipped:
   *"…who chose his own name. And his name, the word itself, Yahweh, does
   reveal something about him."*
   - "**and his name**" must not sound sped-up or chipmunky.
   - "…**about him.**" must be fully audible, including the "him."
4. **Listen to 4:45 → 5:00.** You should hear *"…at the burning bush in Exodus
   chapter 3."* — the "**3**" at the end must be spoken and audible. That single
   word being skipped is the bug this whole issue was about.
5. **Watch the counter.** The Smart Speed button in the control row counts up
   the time it has saved. It should move — slowly. On this video, expect it to
   reach roughly **15–20 seconds saved by the end of the 26 minutes**, not
   minutes. If it is racing up, something is wrong; tell me.
6. **Scrub around minutes 3 to 6 and just listen.** Anywhere a word sounds
   clipped, swallowed, or fast, note the timestamp — that is a bug and I want
   the number.
7. **Now try it on your phone.** Open the same note in Obsidian on the iPhone
   and play the same stretch. It will skip a bit less than the Mac does (the
   phone has no ffmpeg, so it works from caption timing alone) but nothing
   should be clipped or chipmunky. If the Mac has already analysed the video and
   iCloud has synced, the phone may match the Mac.
8. **One video that is not this one.** Play any other video you like for two or
   three minutes with Smart Speed on, and listen for the same three things:
   clipped words, swallowed words, chipmunk speech. Note timestamps for anything
   you hear.

**What "it worked" looks like:** every word is audible at normal speed, the
pauses between sentences are shorter than they were, and the saved-time counter
moves at a believable trickle rather than a run.

**If a word still gets swallowed**, tell me the video ID and the timestamp to
within a second or two. That is enough for me to pull the exact caption timing
and the exact silence window and see which one was wrong.

**Do not change anything under Advanced** to "fix" a problem you hear. Those
three dials all trade safety for aggressiveness, and moving them is how the
original bug was possible. Report what you heard instead.
