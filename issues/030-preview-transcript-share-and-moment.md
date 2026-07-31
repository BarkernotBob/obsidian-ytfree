# 030 — Preview's transcript, the share icon, and "this moment"

Six corrections from using 028 and 029 on a screen.

## What was wrong

1. **Preview's transcript was a line a second.** It showed raw caption cues;
   the note's transcript groups them into paragraphs of `transcriptIntervalSeconds`
   (20). The same video read as two different documents.
2. **It followed the video even while being read.** Autoscroll had no way to be
   turned off, so reading ahead was impossible — the list dragged itself back.
3. **Opening it pushed the video off the screen.** A modal that grows re-centres
   itself, and `scrollIntoView` scrolls every ancestor that can scroll.
4. **Share looked like Download.** Lucide's `share` is a box with an arrow
   rising out of it — the same silhouette as `download` two buttons along.
5. **A jump to the transcript existed only from the five replay peaks.** There
   was no way to ask "where am I in the transcript right now".
6. **A copied link ignored the lookback.** A typed timestamp is shifted back
   `lookbackSeconds` (5); a shared one was not, so it landed just past the thing
   being sent.

## What it does now

- Preview groups cues with the note's own `transcriptIntervalSeconds`, and the
  header counts sections rather than lines.
- The transcript follows the video until a wheel, a drag, a touch-move or a key
  says otherwise, and follows again the moment a paragraph is clicked or the
  section is reopened. Manual scrolling is caught at the *input*, not at the
  `scroll` event, because our own autoscroll fires that too.
- The sheet is one scroller capped at the viewport with the player `sticky` to
  its top; the highlight moves one `scrollTop`, on the transcript box alone.
- Share is a curved arrow leaving to the right — our own icon (`ytfree-share`),
  the shape YouTube uses — on the control bar and in the Preview action row.
- **This moment**: a fourth link on the section row, and the command *Jump to
  this moment in the transcript*. It goes to the transcript paragraph covering
  the playhead. On the section row rather than among the icons because it
  navigates the note, and because the right-hand icon group on a phone is
  already four 40pt targets in half a screen.
- Shared timestamps carry the lookback, and the menu item shows the shifted time
  because that is where the link goes.

## Acceptance criteria

- [x] Preview's transcript paragraphs match the note's transcript for the same
      video and the same setting.
- [x] Autoscroll stops on a manual scroll and resumes on a paragraph click.
- [x] The Preview player stays visible while the transcript is open and moving.
- [x] Share's icon is distinct from Download's at control-bar size.
- [x] A command and a control-bar link jump to the transcript at the current
      playback position, for any moment, not just a peak.
- [x] A copied or shared link at 12:34 with a 5-second lookback points at 12:29.
- [x] 422 unit tests pass; `tsc` clean; build clean.

## Manual test (for BarkernotBob)

**Preview's transcript (1, 2, 3)**

1. Open the YT Free hub and press **Preview** on any video with captions.
2. Wait for the header under the description to read "Transcript · N sections",
   then click it.
3. Read the paragraphs: each should be a chunk of about 20 seconds — the same
   size as the ones in a video note — not one short line per second.
4. Press play. Every 20 seconds or so the highlighted paragraph should change
   and the list should re-centre on it, **while the video stays put at the top
   of the sheet**. It must not slide up out of view.
5. Scroll the transcript down by hand while the video plays. It should stay
   where you put it — no snapping back.
6. Click any paragraph. The video jumps there and the list starts following
   again.

**The share icon (4)**

7. Open a video note with a player. Look at the control bar: the Share button
   should be a curved arrow flying off to the right, clearly different from the
   Download button's downward arrow into a tray.
8. Same check in Preview's row of four buttons.

**This moment (5)**

9. In a video note that has a transcript, play a few minutes in.
10. Press **This moment** — the fourth link on the row under the control bar.
    The note should scroll to the transcript paragraph of what is being said
    right now.
11. Do the same from the command palette: *YT Free: Jump to this moment in the
    transcript*.
12. On a note with no transcript yet, it should say so rather than doing
    nothing.

**The lookback on a shared link (6)**

13. With Settings → YT Free → lookback at 5 seconds, play to about 12:34 and
    press **Share**.
14. The second menu item should read "Copy link at 12:29" (not 12:34), and the
    copied URL should end `?t=749`.
15. Do the same in the first five seconds of a video: the timestamped item
    should copy a plain link with no `?t=` at all.
