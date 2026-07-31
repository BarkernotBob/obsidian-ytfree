# 028 — The transcript in Preview, and a jump from a peak to it

Status: **Built 2026-07-31 — awaiting manual test.**

## The problem

Two halves of the same gap.

**Preview could not answer "what is this about".** It had the first thirty
seconds and a description the uploader wrote to be clicked on. The transcript —
the one thing that says what is actually in a twenty-minute video — was
withheld, because in 024 the whole withheld set was "things that need a note"
and the transcript was filed with them by habit rather than by reason. It needs
no note; it needs a video ID.

**And in a note, a replay peak was a dead end.** The timestamp plays the moment,
which is right when you want to watch it and wrong when you want to read around
it. There was no way from "eight people rewound here" to the words.

## What was built

**A transcript under the description in Preview**, collapsed, with the fetch
started on open rather than on expand. Those are deliberately two events: the
fetch is two round trips, and a control you press and then wait for is a control
you stop pressing. It lands while the stream is still resolving, so by the time
anyone opens it, it is there. A video with no captions says so in the header and
the header stops being pressable — it never opens onto nothing.

Each line is a button that seeks the preview player, and the line being spoken
lights up as it plays and scrolls itself into view.

**The handle the hub holds is three functions wide now** — `destroy`, `seek`,
`currentTime` — where it was one. The highlight is polled off `currentTime`
every 400 ms rather than driven by an event: the seam between the hub and the
player engine is one small interface on purpose, and it is not the place to
grow an event bus for one highlight. The tick only runs while the transcript is
open.

**A `¶` beside every peak, in the note.** It scrolls the note to the transcript
paragraph covering that moment, and moves the video not at all — so it works
whether or not anything is playing, which is the reason it sits *beside* the
timestamp instead of replacing it. Reading view and the editor both handle it,
because a video note is as often read as edited.

**The mode rides on the `ytfree:` scheme, not a second one.** `ytfree:ID:754:t`
is a transcript jump; `ytfree:ID:754` is the seek it has always been. There are
four click paths for these links — reading view, Live Preview, and a touch
sequence for each — and a parallel scheme would have been four more places to
keep in step. The mode is now part of a tap's identity in the arm-then-fire
guards, which matters here specifically: a peak line carries a play link and a
jump at the *same second*, side by side.

**`transcriptIntervalSeconds` drops from 60 to 20.** A jump can only land on a
paragraph, so the paragraph is how close it can get, and a minute of slack is
enough to land past the thing you clicked for. Notes already written keep the
size they were built with; re-fetching a transcript rewrites it at 20.

**`transcriptLineFor` reads the note, not a cue list.** By the time anyone
clicks, the note is the only copy of the transcript that exists — the fetch is
written once and never repeated. It takes the last paragraph starting at or
before the moment, and the peak list above it can never be mistaken for a
paragraph because peaks are list items.

## Acceptance criteria

- Preview shows a collapsed **Transcript** row; expanding it is instant a few
  seconds after the sheet opens, with no button pressed to start the fetch.
- Clicking a transcript line in Preview seeks the preview player to it.
- The line being spoken is highlighted, and follows playback.
- A video with no captions says so and does not open.
- In a note, `¶` beside a peak scrolls to that part of the transcript, in both
  reading view and the editor, without touching the video.
- The timestamp beside it still plays the moment, as it always did.
- A newly fetched transcript is in ~20-second paragraphs.

## Manual test (for BarkernotBob)

1. Open the hub, press **Preview** on any video with a few thousand views.
2. Watch the sheet: a **Transcript** row appears under the description. Wait
   about two seconds without touching it, then click it — it should open
   straight onto the words, not onto "Loading…".
3. Press play, then click a line about a minute in. The video should jump there.
4. Let it play with the transcript open: the current line should light up and
   scroll itself into view.
5. Preview something obscure with no captions (a very small channel). The row
   should read "Transcript — none for this video" and not open.
6. Now open a video note with a **Most replayed** section and run **Fetch
   transcript and most-replayed moments** from the command palette to rewrite
   it at the new paragraph size.
7. Each peak should read `**1:40** ¶ — the words`. Click the **1:40** — the
   video plays from there. Click the **¶** — the note scrolls to that part of
   the transcript and the video keeps doing whatever it was doing.
8. Switch to reading view and click a `¶` there too.
