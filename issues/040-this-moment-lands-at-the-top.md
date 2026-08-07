# 040 — "This moment" lands the current line at the top, not the middle

Status: **Built 2026-08-06 — not yet tested on the phone.** From BarkernotBob's
manual test of
[035](035-follow-unfold-cursor-progress.md):

> "Clicking this moment makes the transcript follow, but the current section is
> too low. Make the current section be top aligned to be just below the action
> bar, rather than the section starting near the middle of the screen."

## What is wrong

The jump works; the resting position is wrong. Landing the current line near the
middle of the viewport spends the whole upper half of the screen on transcript
you have already heard, and leaves only half a screen of what is coming — which
is the half you read. On a phone that is a few lines of lookahead where there
could be twice as many.

The likely cause is a `scrollIntoView` with a centring block, or a computed
offset that subtracts half the viewport. Either way the target is "centre",
and it should be "top, less the height of what is pinned above it".

## What it should do

Scroll so the current line sits **immediately below the action bar** — the
smallest offset that clears whatever is pinned above the scrolling region, plus
a small breathing margin so the line does not touch the bar.

Details that decide whether it feels right:

- The offset is measured from the *pinned* chrome, not hard-coded. The control
  bar's height differs between phone and desktop, between Preview and a note,
  and with [039](039-transcript-pinned.md) it may change again. Measure it.
- The same resting position applies to follow-mode's own autoscroll, not only to
  the "this moment" jump. Two different resting positions for the same line
  would read as the transcript drifting on its own.
- Near the end of the transcript the last lines cannot be scrolled to the top,
  and should not be faked with padding that leaves a blank screen. Let the
  scroll bottom out; the highlight still says which line is current.
- The unfold-before-jump behaviour 035 added stays exactly as it is — this is
  only about where the scroll comes to rest afterwards.

## Acceptance criteria

- [ ] Tapping "this moment" leaves the current line just below the action bar,
      not near the middle.
- [ ] Follow-mode's autoscroll comes to rest at the same place.
- [ ] Correct in Preview and in a note, on the iPhone and on the Mac, with the
      offset measured from the real chrome rather than assumed.
- [ ] At the very end of a transcript the scroll bottoms out cleanly with no
      blank space below the last line.
- [ ] "This moment" still unfolds a collapsed transcript before scrolling.
- [ ] `tsc` clean, build clean, unit tests pass.

## How it was built

One rule, `restingScrollTop` in `src/transcript.ts`, used by both halves: take
the line's offset from the top of the scrolling region, subtract a small
breathing margin, and clamp to what there is to scroll. The clamp is what makes
the end of a transcript bottom out cleanly instead of asking for blank space
below the last paragraph.

In Preview the region is the transcript's own box, so `revealRow` sets one
`scrollTop` and moves nothing else on the sheet. In a note the pinned player is
a *sibling* of the editor's scroller rather than something sticky inside it, so
"immediately below the action bar" is the scroller's own top edge plus that
margin — no number about the player appears anywhere. `scrollToLine` asks
CodeMirror for `y: "start"` with a margin, because Obsidian's own
`Editor.scrollIntoView` offers only centred or barely-on-screen, and
barely-on-screen from below is the same defect pointing the other way.

Both the "This moment" jump and follow mode's autoscroll go through
`scrollToLine`, so there is one resting place rather than two.

## Manual test (for BarkernotBob)

In a video note with a transcript:

1. Play the video and let it run a couple of minutes in.
2. Tap **This moment**. The paragraph being spoken should land just under the
   player and the action bar — near the top of the text, not halfway down the
   screen with the last two minutes above it.
3. Keep watching without touching anything. As the transcript follows along,
   each new paragraph should come to rest in that same place.
4. Skip to the last minute of the video and tap **This moment** again. The
   transcript should stop at the end of the text — no empty space scrolled in
   below the final paragraph.
5. Switch the note to Reading view and repeat step 2.
6. In Preview, open the transcript and play. The current paragraph should rest
   near the top of the transcript box, and the same "no blank space at the end"
   applies.
