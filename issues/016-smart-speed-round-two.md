# 016 — Smart Speed round two: skip the fluff, and keep up with playback

Status: **Scoped 2026-07-29, building.** Follows [015](015-smart-speed.md) after BarkernotBob's
first real session with it.

BarkernotBob, after testing 015 with ffmpeg installed:

1. *"Musical interludes should still be cut, or at least that should still be an option.
   The idea is to let this get you straight to the content, cutting the fluff."*
2. *"I seem to be having NOTHING skipped at all with FFMPEG on … no number is accruing
   like it did with transcription skips."*
3. *"If it takes that long to begin, yes I need it to work in parallel. Once I'm 5 seconds
   into the video, those first 10 seconds should be ready to smart skip through FFMPEG."*

## What 015 got wrong

**015's premise was that ffmpeg is strictly better than caption timing**, because
measured audio can tell a musical interlude from a pause and caption gaps cannot. Item 1
says that distinction is backwards for this user: an interlude is fluff, and fluff is the
thing Smart Speed exists to skip. So ffmpeg stops being a *replacement* map and becomes a
*second* map, and playback compresses the **union** of the two.

That single change also fixes item 2, which is a real bug and not a misconfiguration:

- `player.setSilenceWindows(windows, source)` **replaces** the whole map, and the ffmpeg
  producer calls it on every batch carrying only what it has analysed so far.
- Analysis of a streamed googlevideo URL runs at **1.9× realtime** (measured: 300 s of
  audio in 154 s, 1 % CPU — the connection is throttled, not the decoder). At BarkernotBob's
  4× playback the analysis is permanently behind the playhead.
- So the complete 362-window transcript map was being swapped out, batch by batch, for a
  map covering only video that had already played. Nothing to skip, nothing to accrue.
- Under a union this cannot happen: an incomplete ffmpeg map can only ever *add*.

And item 3 is fixable outright, because the throttle is **per connection**:

| run | audio analysed | wall | rate |
|---|---|---|---|
| one stream | 300 s | 154 s | 1.9× |
| six parallel chunks | 360 s | 37 s | **~10×** |

Measured 2026-07-29 against a real audio URL. `-ss` before `-i` seeks by HTTP range, so a
chunk costs only its own bytes. **silencedetect reports timestamps relative to the chunk**
— every window needs its chunk offset added, and that is the one thing in this issue that
will silently produce a plausible, wrong map if it is got wrong.

## The build

1. **Union model.** New setting **Skip non-speech audio (music, intros)**, default **on**.
   On: playback compresses `transcript ∪ ffmpeg`. Off: 015's behaviour — ffmpeg is
   authoritative where it has analysed, transcript fills in beyond its frontier (never a
   bare partial map again).
2. **Chunked parallel analysis.** Six workers, 60 s chunks, 3 s overlap so a pause
   straddling a boundary is not cut into two sub-threshold halves; windows offset by chunk
   start and touching windows merged. Chunks are ordered **outward from the playhead**, so
   the part being watched is analysed first.
3. **Store both maps per video.** `silence-maps.json` goes to version 2: one entry per
   video holding a map per source, each with its own `minGap`, `computedAt` and — for
   ffmpeg — `analyzedTo`. A v1 file migrates on read. `analyzedTo` means a cancelled
   analysis is resumable rather than either lost or, as in 015, recorded as if complete.
4. **Lead-out 0.1 s → 0.25 s.** BarkernotBob: *"It sometimes slightly cuts into the speaking
   with the speed up right before it slows back down."* Caption cue starts are only
   accurate to a few hundred ms, and a union map keeps those loose boundaries by design.

## What this costs, stated plainly

With "skip non-speech" on, **ffmpeg adds much less than 015 claimed** on a captioned
video: the caption map already covers every stretch with no words in it, which is most of
what a union contains. ffmpeg's remaining value is real but narrower — videos with no
captions at all, and pauses inside a caption cue's own span. BarkernotBob installed ffmpeg
expecting accuracy; item 1 is what changes the deal, not the install.

## Acceptance criteria

1. A video with a musical intro compresses the intro, with ffmpeg installed and the new
   setting on.
2. Time saved accrues with ffmpeg installed — the 015 symptom does not reproduce at 4×.
3. The first minute of a video is analysed within ~40 s of pressing play, and the map
   stays ahead of a 4× playhead thereafter.
4. Turning the new setting off restores 015 behaviour: quiet music is not compressed.
5. Killing a note mid-analysis stores a partial map with `analyzedTo`, and reopening
   resumes from there rather than restarting or treating it as complete.
6. A v1 `silence-maps.json` loads without loss.
7. Unit tests: union/merge, chunk plan, chunk offsetting, v1→v2 migration.

## What was proved before shipping

`node --experimental-strip-types spikes/silence-chunks/run.mjs` runs the real chunked
producer against a real audio URL and compares it with a single-stream analysis of the
same stretch. 2026-07-29, first 240 s: **all 27 single-stream windows matched a chunked
window within 0.5 s**, contiguous frontier 240 s, 48 s wall against 176 s (3.65× with four
workers on a slice that short). That comparison is the only thing that can catch the
`-ss` offset being wrong, because a wrongly shifted map is still a perfectly plausible map.

## Manual test (for BarkernotBob)

About 10 minutes, Mac only — nothing here needs the phone or the terminal. The build is
already installed.

1. Obsidian → Settings → Community plugins → toggle **YT Free** off, then on. (Required,
   not optional: the plugin remembers "no ffmpeg on this machine" for the whole session,
   and yours was started before ffmpeg existed.)
2. Settings → YT Free → Smart Speed. There is a new row, **Skip non-speech audio**,
   already on. Set **Shortest pause to skip** back to **0.5 s** and **Pause speed** to
   **3×** for this test — 0.2 s and 4× make step 4 harder to hear.
3. Open the note you were testing with and play it. Within about ten seconds the time
   saved should start climbing again, and it should **keep** climbing. That is the bug
   you reported: the number stalling at nothing was the ffmpeg map wiping the caption map.
4. Let it run two or three minutes at 3×, then bump the speed picker to **4×** and keep
   listening. The number must keep climbing at 4× too — that is the specific case that
   failed, because the analysis was slower than you were watching.
5. Find a video with a musical intro or an interlude between sections. It should now be
   **compressed**, not played through. This is item 1, and it is the opposite of what 015
   did with ffmpeg installed.
6. Turn **Skip non-speech audio** off, reopen that video, and play the same interlude. It
   should now play at normal speed. Turn it back on.
7. Open a video the Mac has never played, play 20 seconds, then close the note. Reopen it
   and play again — it should pick up rather than start the analysis over.
8. View → Toggle Developer Tools → Console, and play something. You should see one line
   like `YT Free: Smart Speed analysing <id> with ffmpeg (1834s, from 0s)`. **If that line
   does not appear, ffmpeg is not being reached at all** and everything above is the
   caption map doing the work — say so, and that is the next thing to chase.
9. Listen for the thing you described last time: the speed-up cutting into the first word
   after a pause. The margin went from 0.1 s to 0.25 s. If it still clips, say so — that
   constant is one line.

**What to report back:** which numbered step, what you expected, what happened. Steps 4,
5 and 8 are the three I want to hear about.
