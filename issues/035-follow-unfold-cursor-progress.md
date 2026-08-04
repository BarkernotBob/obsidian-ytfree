# 035 — The transcript follows in the note, and three things that got in its way

Four notes from the dev inbox, all about reading a transcript in the note
rather than in the Preview sheet.

Each was one line long. What each was taken to mean is written out under
[Reading the four lines](#reading-the-four-lines) below.

## What was wrong

1. **The note's transcript did not follow the video.** Checked first: the
   follow built in [030](030-preview-transcript-share-and-moment.md) lives in
   `PreviewModal` (`src/hub.ts`) and nowhere else. The note — which is where a
   transcript is actually read, because it is the only place you can write
   beside it — had nothing. Play a video, look away, look back, and finding the
   sentence again was a scroll and a guess.
2. **"This moment" landed inside a folded section.** The transcript is folded
   when a note opens ([017](017-skip-fold-tidy.md)) and folded again by every
   second tap on its button, so most of the time the paragraph the jump scrolls
   to was not on the screen at all. The scroll ran, the flash ran, and the
   reader saw a link that did nothing.
3. **The Notes button always went to the top of the section.** It scrolled to
   the heading and left the cursor wherever it had been. On a note with a page
   of writing in it, the button meant to take you back to writing took you to
   the first line and left you scrolling to the end of your own paragraph.
4. **The progress line stopped 16px short of each edge.** The inset was added
   in [021](021-restore-pill-seek-drag-pending-play.md) so the line would sit
   over the picture rather than over the black bars beside it; the effect on a
   phone, where the picture *is* the width, was a line that visibly missed both
   corners.

## What it does now

- **The note's transcript follows the video**, tinting the paragraph being
  spoken and scrolling to it as it changes, at the same 400ms tick Preview
  uses. It stops on a wheel, a drag, a touch-move or a key — caught at the
  *input*, not at the `scroll` event, because our own scrolling fires that too
  — and on folding the transcript, on leaving for another section, on the note
  or the player going away, and on unload.
- **It has to be asked for.** Preview can follow from the moment its transcript
  is opened, because there the transcript is its own scroller. A note is one
  column: following it from the moment a video plays would drag a writer off
  their own notes. So it starts on the three gestures that mean *I am reading
  the transcript now* — **This moment** (button or command), the **Transcript**
  section button, and a tap on a transcript paragraph, which is Preview's own
  resume. A **Follow the video** setting (on by default) turns the whole thing
  off, immediately, not at the next note.
- **Input inside the player does not stop it.** Preview's listeners sit on its
  transcript box alone, so pressing play there does not end the follow. In a
  note the only element wide enough to catch a scroll is the whole view, and the
  player is inside it — so events from `.ytfree-wrapper` are ignored, and
  pausing, dragging the picture to seek, or pressing This moment leaves the
  follow it just asked for alone.
- **A jump unfolds first.** `revealLine` drops whichever fold hides the target
  line, and only that one — a jump to the transcript is not a request to open
  the description as well — then scrolls a tick later, so the scroll is measured
  against the height the note ends up at rather than the one it had while the
  section was shut.
- **The Notes button comes back to the last thing typed.** Every keystroke under
  a note's `# Notes` records its spot; the button returns there when it is still
  inside the section, and to the line under the heading when it is not. The
  column is clamped to the line it lands on, because notes get edited between
  visits. This is the existing mechanism — `lastJump`, `inSection`, the same
  `setTimeout(…, 0)` after the unfold — with one map added, not a second way to
  navigate.
- **The progress line runs the full width of the picture**, corner to corner.
  `--ytfree-progress-inset` still exists and still defaults through, so a
  snippet can put the 16px back.

## Reading the four lines

The inbox lines were terse. Taken to mean:

- *"In video transcript follow"* → the behaviour of 030, in the note. Not
  always-on the way Preview's is: see "It has to be asked for" above. This is
  the one judgement call in the issue that could have gone the other way.
- *"This moment needs to open a collapsed transcript"* → unfold, then scroll,
  then flash — in that order, on both the button and the command. Unfolding on
  a click is navigation, not a reflow: it is the whole point of pressing the
  thing.
- *"Notes button takes you starting to last cursor position"* → the cursor, not
  just the scroll, and the *last place typing happened in this note's Notes
  section*, not the last cursor position anywhere (which would be inside the
  transcript half the time and would send the next keystroke into someone
  else's words).
- *"Make the video progress bar full width"* → the width of the picture, which
  is what `.ytfree-progress` is positioned against — not the width of the note.

## Acceptance criteria

- [x] The note's transcript follows playback after This moment, the Transcript
      button, or a tap on a transcript paragraph.
- [x] A wheel, drag, touch-move or key in the note stops it; a tap on the player
      does not.
- [x] Folding the transcript, leaving for another section, closing the note,
      unloading the plugin and turning the setting off all stop it.
- [x] The followed paragraph is marked with a background alone — nothing around
      it moves as the mark travels.
- [x] "This moment" and *Jump to this moment in the transcript* unfold a folded
      transcript before scrolling, and leave every other fold as it was.
- [x] The Notes button puts the cursor back where the typing stopped, and falls
      back to the line under the heading for a note never written in.
- [x] The progress line touches both edges of the picture, portrait and
      landscape, phone and desktop, pill and immersive.
- [x] 438 unit tests pass; `tsc` clean; build clean.

## Manual test (for BarkernotBob)

**Following (1)**

1. Open a video note that has a transcript, and play a minute or so in.
2. Press **This moment**. The note should open the transcript if it was folded,
   scroll to the paragraph being spoken, flash it yellow, and then leave it
   faintly tinted.
3. Let it play. Every 20 seconds or so the tint should move to the next
   paragraph and the note should scroll to keep it in view. Watch the words
   around the tinted paragraph — nothing should shift sideways or reflow as the
   tint moves.
4. Scroll the note by hand. Following should stop dead — no snapping back.
5. Press **This moment** again. It should pick up where the video now is.
6. Press pause, then play, on the video's own control bar. Following should
   **keep going** — touching the player is not taking over the note.
7. Type a word in the Notes section. Following should stop.
8. Tap any transcript paragraph. The video jumps there and following starts
   again — and the paragraph you tapped should stay exactly where your finger
   was, no scroll.
9. Press the **Transcript** section button. Following starts from wherever the
   video is.
10. Press the **Transcript** button a second time (it folds the section).
    Following should stop.
11. Settings → YT Free → **Follow the video**, turn it off while something is
    following. It should stop immediately, and This moment should then only
    jump.

**This moment into a folded transcript (2)**

12. Open a video note fresh, so the transcript is folded. Play a few minutes in.
13. Press **This moment**. The transcript should unfold and the note should land
    on the right paragraph, flashing yellow — not sit on a closed heading.
14. Fold the Description section by hand first, then press This moment again.
    The description must still be folded afterwards.
15. Same from the command palette: *YT Free: Jump to this moment in the
    transcript*.

**The Notes button (3)**

16. In a video note in editing (not reading) mode, write two or three
    paragraphs under **# Notes**, leaving the cursor mid-sentence at the end.
17. Press the **Transcript** button, read for a bit, then press **Notes**. The
    cursor should be back exactly where you stopped typing, ready to keep going
    — not at the top of the section.
18. Do it again with a note that has nothing under # Notes: the cursor should
    land on the empty line under the heading.
19. Delete the paragraph you were typing in, then press Notes. It should fall
    back to the line under the heading rather than putting the cursor
    somewhere odd.

**The progress line (4)**

20. On the Mac, play a video in a note. The thin purple line at the bottom of
    the picture should run corner to corner — no gap at either end.
21. Same on the phone, portrait.
22. Rotate to landscape (immersive). Still corner to corner.
23. Shrink the note pane narrow enough that black bars appear beside the
    picture: the line should span the picture's full box, which is what it is
    drawn on.
