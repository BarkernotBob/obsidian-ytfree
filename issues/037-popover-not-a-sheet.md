# 037 — The phone pop-out is a popover again, and still does not clip

Status: **Scoped 2026-08-06 — not built.** From BarkernotBob's manual test of
[032](032-mobile-preview-window.md):

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

## Manual test (for BarkernotBob)

_Written when this is built._

## Deliberately left alone

Everything else 032 fixed — the description's sideways scroll, the collapse
button, the single scroller, PiP surviving a close. Only the pop-out's presentation
is in scope here; see [039](039-transcript-pinned.md) for the scroll-order
complaint from the same test run.
