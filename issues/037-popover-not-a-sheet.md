# 037 — The phone pop-out is a popover again, and still does not clip

Status: **Built 2026-08-06 — not yet tested on the phone.** From BarkernotBob's manual
test of [032](032-mobile-preview-window.md):

> "1 doesn't clip anymore, but now it sits in the window real weird. I still
> want it to popover like it was, just without clipping."

## What happened

032 was given one symptom — the pop-out controls menu ran off the edge of the
screen — and fixed it by changing what the pop-out *is*. On a phone it became a
bottom sheet, because a sheet anchored to the bottom of the viewport cannot
clip against an ancestor no matter how the ancestor is sized.

That closed the bug and lost the thing. A popover anchored to the button you
pressed says *these controls belong to that button*; a sheet that rises from the
bottom of the screen says nothing about where it came from, and in the Preview
window — which is itself a panel, not the whole screen — it reads as a second
unrelated surface laid over the first. That is the "sits in the window real
weird".

## Why it clipped in the first place

032's own finding, kept here because it is the constraint any fix has to clear:
the cap on the menu's height was measured from the top of the *screen* to the
control bar, but in Preview the element that clips is not the screen — it is an
ancestor of the player with its own bounds and its own `overflow`. A correct
number measured against the wrong box. Growing the number does not help; the
menu is being cut by a container, not by the viewport.

## What it should do

**Take the popover out of the clipping ancestor entirely.** Render it into the
document-level container Obsidian already uses for menus and modals — a portal —
and position it against the button's viewport rect rather than against any
ancestor's coordinate space. A node that is not a descendant of the clipping box
cannot be clipped by it, so the constraint stops applying instead of being
worked around.

Then the ordinary popover rules apply, all measured against the *viewport*:

- anchored to the button, opening upward when there is more room above and
  downward when there is more below;
- flipped horizontally rather than allowed to run past either edge;
- capped at the space actually available, with the menu itself scrolling if the
  cap bites — the menu scrolls, not the page behind it;
- dismissed on outside tap, on scroll of the surface behind it, and on Escape;
- and it must survive the Preview sheet being scrolled, since a portalled node
  does not move with its anchor for free. Reposition on scroll and on resize, or
  close.

The bottom sheet goes away on the phone. Desktop behaviour is already a popover
and does not change.

## Acceptance criteria

- [ ] On the iPhone, the pop-out opens as a popover anchored to its button, in
      Preview and in a note.
- [ ] No edge of the popover is cut off, in either orientation, in Preview or in
      a note, with the surface scrolled to the top and scrolled to the bottom.
- [ ] When there is not enough room, the popover scrolls internally; the surface
      behind it does not scroll with it.
- [ ] Scrolling the Preview sheet with the popover open either moves it with the
      anchor or closes it — it never detaches and floats over unrelated content.
- [ ] Outside tap, Escape and the button itself all close it.
- [ ] Opening and closing it moves nothing on the surface behind it.
- [ ] Desktop is unchanged.
- [ ] `tsc` clean, build clean, unit tests pass.

## How it was built

`panelPlacement` in `src/panel.ts` grew a second mode. Docked (the desktop) is
what it always was: a cap on the height, measured from the control bar to the
top of the screen. Anchored (any phone, Preview or note) takes the button's
rectangle, the panel's own measured size and the visual viewport, and returns
`left`/`top`/`width`/`maxHeight` plus which side it opened on. It stays
`position: fixed`, because that is the thing that actually escaped the clipping
ancestor in 032 — the sheet was never what fixed the clipping.

Rules the placement follows, all covered by `tests/panel.test.ts`:

- it hangs off the button, right edges aligned, and is clamped so no edge leaves
  the screen in either orientation;
- it opens upward when there is room above, downward when there is not, and
  upward when both would fit — covering the picture costs less than covering the
  text;
- when neither side fits it takes the bigger one and says so with a `maxHeight`
  it will scroll inside;
- the visual viewport, not `innerHeight`, so a raised keyboard shrinks the room
  rather than being ignored.

Because a fixed node does not travel with its anchor, the player watches
`scroll` (capture phase — scroll does not bubble), `resize` and the visual
viewport while the panel is open, re-places it on each, and closes it outright
once the button is off screen or under the chrome. The scrim is transparent
rather than dimmed: a popover is not a modal.

## Manual test (for BarkernotBob)

On the iPhone, in the Preview sheet:

1. Open any video's Preview and tap the pop-out button (the rightmost of the
   three on the right of the control bar).
2. The menu should appear **attached to that button** — hanging just above it,
   right edges lined up — not sitting at the foot of the screen.
3. Every row should be readable. Nothing cut off at the top or the bottom.
4. Tap the pop-out button again. It closes.
5. Open it again and scroll the sheet behind it. The menu should either follow
   the button or close when the button goes off screen — it must never sit
   still while the button moves away underneath it.
6. Turn the phone sideways with the menu open, then open it again. Same
   attached-to-the-button behaviour, nothing off the edge.
7. Open a video note (Watch), and do 1–5 again on the note's player.
8. On the Mac, open a Preview and the same pop-out. It should be exactly as it
   was — docked above the control bar, no change.

## Deliberately left alone

Everything else 032 fixed — the description's sideways scroll, the collapse
button, the single scroller, PiP surviving a close. Only the pop-out's presentation
is in scope here; see [039](039-transcript-pinned.md) for the scroll-order
complaint from the same test run.
