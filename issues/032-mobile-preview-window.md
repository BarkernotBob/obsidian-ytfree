# 032 — The Preview window on a phone

Five defects from using Preview (024, 028, 030) on an iPhone. Four are layout;
the fifth is a question about what a closing sheet owes a video that is still
playing.

## What was wrong

1. **The pop-out controls menu clipped offscreen.** The panel is capped at the
   distance from the top of the screen down to the control bar — a correct
   number measured against the wrong box. Inside Preview the panel's clipping
   ancestor is not the screen, it is `.modal-content`'s scroller, whose top edge
   is the top of the *video*. Measured on a 390×844 phone
   (`tools/preview-sheet-harness.mjs`): the panel rendered at 30–280, the
   scroller runs 76–768, so the first 46pt — the first two rows — were cut off.
   No `max-height` fixes this. A box cannot fit inside a shorter box.
2. **The description scrolled sideways.** `overflow-y: auto` with `overflow-x`
   left unstated computes the x axis to `auto` too: the pair cannot disagree.
   Any description with a bare playlist URL or a run of `─` characters — one
   unbreakable token to the line breaker — became horizontally scrollable.
3. **Collapse did nothing**, for two independent reasons, either of which alone
   was enough. The handler looked the player up by video id in `players`, and a
   preview player is deliberately *not* in that map (024). And the `.is-collapsed`
   CSS was written for `.ytfree-docked` only, so even with the right player the
   class landed on an element no rule matched.
4. **The title didn't scroll with the description.** The description was its own
   22vh inner scroller, so the sheet had two nested scrollers: the title and
   facts sat in the outer one and never moved, while eight lines of description
   crawled past in a window a fifth of the screen tall.
5. **Closing the sheet killed playback.** `onClose` destroyed the player
   unconditionally, so there was no way to put a video in Picture-in-Picture and
   keep it while doing something else.

## What it does now

- **On a phone the pop-out is a bottom sheet, not a popover.** `position: fixed`
  at the foot of the viewport, `max-height: 62vh` (the hub disclosure panel's
  height, MOBILE-UX §1), scrolling internally, 44pt rows. Fixed is the fix:
  a fixed element's containing block is the viewport, so no scroller clips it —
  verified, nothing on the modal chain sets a `transform`/`filter`/`contain` that
  would drag the containing block back down. It now renders 540–844, whole.
- **A scrim comes with it**, because a bottom sheet over a modal has two things
  a tap outside could mean. The scrim closes the menu only; without it the tap
  falls through to `.modal-bg` and closes the Preview too. It closes on `click`,
  not `pointerdown` — a scrim that hides itself on `pointerdown` is gone before
  the browser picks a click target, which reintroduces the bug it exists to
  prevent. The scrim is `visibility`/`opacity`, never `display`, and is in the
  DOM from mount: opening the menu inserts no nodes and moves nothing.
- **Both overflow axes are stated everywhere the sheet scrolls**, plus
  `overflow-wrap: anywhere` on the title, description and transcript so a long
  URL breaks instead of needing to be scrolled to. Measured horizontal overflow
  in the sheet and in the description: 0.
- **Collapse takes the `PlayerEntry` from the closure** rather than looking it
  up by id, and the collapsed rules are written for `.ytfree-preview-wrapper`
  too. The picture goes to zero height while the `<video>` stays 202pt tall and
  playing, clipped by `.ytfree-media`'s `overflow: hidden` — `display: none` on a
  playing video stops playback on iOS WebKit, which is the one thing a collapse
  must not do. Collapsing buys the description 184pt.
- **The sheet is one scroller on a phone.** The description gives up its
  `max-height` and its `overflow`, so the title scrolls away under the sticky
  picture (measured: 237pt of travel) and the description gets the whole sheet.
  What the 22vh cap was really protecting — the four action buttons — is now the
  sheet's sticky floor instead, so Watch/Keep/Remove/Share stay reachable at any
  scroll position. The action row sits at `z-index: 1`, below the player's 2:
  both are sticky and both make stacking contexts, and at 3 the row painted over
  the pop-out sheet.
- **A preview in Picture-in-Picture survives its sheet closing.** On a plain
  dismissal with the video in PiP, the wrapper is re-parented into a 1pt clipped
  keep-alive host on `document.body` and plays on, with a Notice saying so;
  leaving PiP tears it down. **Watch** and **Remove** always destroy it — one
  player at a time (024), and the teardown is what writes the position the note's
  player resumes from. The hand-off is in a `close()` override rather than
  `onClose` so it happens while the `<video>` is still demonstrably in the page:
  PiP is a system window over an element that still exists, so a destroyed
  element is a closed PiP window.

The two decisions worth testing as logic rather than as pixels are extracted:
`src/panel.ts` (`panelPlacement` — sheet or capped popover) and `src/preview.ts`
(`previewCloseAction` — keep playing or destroy).

**Not verified on a device.** The PiP path is built and reasoned from the two
APIs — `document.pictureInPictureElement` / `leavepictureinpicture` and WebKit's
`webkitPresentationMode` / `webkitpresentationmodechanged` — but it has not been
run on an iPhone. iOS implements none of the standard API on a `<video>`, so
step 13 below is the real test; if PiP proves unreachable from Obsidian mobile's
webview at all, the fallback is that Preview simply closes as it always did, and
this becomes a scoping note rather than a bug.

## Acceptance criteria

- [x] The pop-out controls menu is entirely on screen on a 390×844 phone.
- [x] Tapping outside the pop-out closes the pop-out and leaves Preview open.
- [x] Opening or closing the pop-out moves nothing else on the screen.
- [x] Nothing in the Preview sheet scrolls horizontally.
- [x] Collapse hides the picture without stopping playback, and gives the space
      to the description.
- [x] The title scrolls with the description; the four action buttons don't.
- [x] Dismissing Preview while in Picture-in-Picture keeps playing; Watch and
      Remove don't.
- [x] 432 unit tests pass; `tsc` clean; build clean.

## Manual test (for BarkernotBob)

On the iPhone, in the YT Free hub.

**The pop-out menu (1)**

1. Press **Preview** on any video and let the player appear.
2. Press the **options** button — the rightmost of the three on the right of the
   control bar. A panel should rise from the bottom of the screen.
3. Check you can see **all** of it: five switch rows, the "This video only" line,
   and the "All YT Free settings…" button at the bottom. Nothing cut off at the
   top, nothing running off the bottom edge.
4. If the panel is taller than about two-thirds of the screen, scroll inside it —
   it should scroll on its own without moving the Preview behind it.
5. Flip a switch. The panel must not resize, and nothing behind it should shift.
6. Tap the dimmed area above the panel. The panel closes; **Preview stays open.**
   (This is the one to watch — it used to close both.)

**Sideways scrolling (2)**

7. Find a video whose description has a long link in it, or a row of dashes.
   Try to drag the description left and right. It shouldn't move — the text
   should be wrapped so there's nothing off to the side to reach.

**Collapse (3)**

8. With the video playing, press the **collapse** (`^`) button on the right of
   the control bar.
9. The picture should disappear and the audio should **keep playing**. The
   control bar stays. Press it again to bring the picture back, still playing
   and still at the same point.

**Reading the description (4)**

10. Scroll the Preview sheet down with the description collapsed *open* (video
    not collapsed). The title and channel line should scroll up out of the way
    under the video, so the description fills the screen.
11. At any point in that scroll, the four buttons — Watch, Keep, Remove, Share —
    should still be visible along the bottom.
12. Combine 8 and 10: collapse the video, then scroll. You should get a nearly
    full screen of description.

**Keeping it playing after closing (5)**

13. Play a video in Preview, then put it into **Picture-in-Picture** (on iOS this
    is the button in the corner of the video, or swipe up to the home screen
    while playing).
14. With the video floating, close the Preview sheet (tap outside it, or swipe
    down). **The floating video should keep playing**, and a brief message should
    say "Still playing in Picture-in-Picture."
15. Tap the floating video's close button. It should stop and go away cleanly —
    no stray audio, and reopening the same video should resume near where you
    left it.
16. Now the opposite: play in Preview *without* Picture-in-Picture and close the
    sheet. The audio must stop immediately.
17. And the hand-off: play in Preview, then press **Watch**. The note opens with
    its own player at the same position, and there should be no second stream
    playing anywhere — no floating window left behind.

If step 13 can't be done at all — if iOS gives no Picture-in-Picture button
inside Obsidian's webview — say so and steps 14 and 15 don't apply; 16 and 17
still do.
