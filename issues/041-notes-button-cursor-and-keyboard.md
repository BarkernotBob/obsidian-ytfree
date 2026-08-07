# 041 — The Notes button gives you a cursor and a keyboard on the phone

Status: **Built 2026-08-06 — not yet tested on the phone.** From BarkernotBob's manual test of
[035](035-follow-unfold-cursor-progress.md):

> "Clicking notes collapses and expands the video player, but on mobile my
> cursor isn't placed in the text and the keyboard isn't deployed."

## What is wrong

035 made the Notes button return you to your last cursor position, and on the
Mac it does. On the phone it scrolls to the right place and stops there: no
caret in the text, no keyboard. So the button does two thirds of a job and
leaves the third — the only one that lets you start typing — to a second tap
somewhere in the note.

That is the whole reason the button exists. You are watching, you have a thought,
you press Notes; if you then have to find and tap the line yourself, the button
has saved you nothing.

`notesCursorTarget()` in [`sections.ts`](../src/sections.ts) already computes the
right line and column. The gap is between computing it and the phone acting on
it.

## Two things to get right, and they are separate

**1. Placing the caret.** The note has to be in edit mode with the editor
focused before a cursor position means anything. On mobile Obsidian a view can
be scrolled without the editor holding focus at all, so `setCursor` on an
unfocused editor sets a position nothing is looking at. Focus first, then set,
then reveal — and confirm which of Obsidian's mobile editing states the note is
actually in rather than assuming it is the desktop one.

**2. Raising the keyboard.** iOS only shows the keyboard when focus lands on an
editable element **inside the task that handled the tap**. The Notes button also
collapses the player, and if any of that work is awaited before focus is
requested, the gesture has lapsed and iOS silently declines the keyboard —
exactly the failure in [038](038-fullscreen-before-play.md), in a different
control. So the focus call has to come first, synchronously, in the tap handler;
the collapse, the scroll and the unfold can all happen after it.

If the order turns out not to be the cause, instrument before patching: log
whether the editor reports focus, and whether `document.activeElement` is the
editable node, at the moment of the tap.

## Also worth deciding

BarkernotBob's note says the button "collapses and expands the video player". If
pressing Notes is meant to hand the screen to typing, collapsing the player is
right and should stay. If it is meant to be a jump that leaves the video where
it is, the collapse is a surprise. Assume the first — you pressed Notes to
write, and a keyboard plus a player plus a transcript does not fit on a phone —
but say so in the issue write-up rather than leaving it implied.

## Acceptance criteria

- [ ] On the iPhone, tapping Notes puts a visible caret in the Notes section at
      the position 035 computes.
- [ ] The keyboard appears without a second tap.
- [ ] Typing immediately after the tap lands in the note, in the right place.
- [ ] It works both when the note was in reading mode and when it was already in
      edit mode.
- [ ] It works when the Notes section is empty and when it has content.
- [ ] Desktop behaviour is unchanged.
- [ ] Whatever the button does to the player is deliberate and stated.
- [ ] `tsc` clean, build clean, unit tests pass.

## How it was built

The order was the cause, and the fix is the order. `jumpToSection` now calls
`openForWriting` — edit mode if it is not in it, then `editor.focus()` — as its
first act, before the fold, the scroll and the collapse, and with no `await` in
front of it. Everything else the button does still happens in the deferred block
it always did; only the focus was moved, because only the focus needs the
gesture.

The caret's *position* stayed where it was, at the end of that deferred block.
Moving a caret inside an already-focused editor needs no gesture, and it needs
the unfold and the scroll to have been laid out first or it sets a position
against stale geometry. So: focus inside the tap, position afterwards.

Two things worth knowing:

- **Reading mode is best-effort.** The mode swap builds the editable node, so
  the focus on the very next line can land on a node that is not in the document
  yet. The deferred block focuses again, so the caret is always placed; the
  keyboard on that one path may want a second tap. Awaiting the swap instead
  would lose the keyboard on *every* path, which is the trade the other way
  round. The swap is mobile-only — on a desktop, reading mode is a deliberate
  state and 041 is about the phone.
- **Collapsing the player is deliberate**, per the question the issue raised.
  Notes is pressed in order to type, and a keyboard plus a player plus a
  transcript does not fit on a phone. The tap that follows expands it again.

`setState`'s promise is dropped on purpose, and iOS refuses a focus outside the
gesture silently, so both are logged behind Settings → Troubleshooting → "Log
what the player is doing" rather than being invisible when this is wrong again.

## Manual test (for BarkernotBob)

On the iPhone, in a video note, with the video playing:

1. Tap **Notes**. The keyboard should come up **on that tap**, with a blinking
   caret in the Notes section — not after a second tap on the text.
2. Type a word straight away, without touching the screen again. It should land
   in the note, where the caret was.
3. Tap **Transcript**, then **Notes** again. It should come back to the end of
   what you just typed, keyboard and all.
4. Do it in a note whose Notes section is **empty**. Same: caret on the empty
   line under the heading, keyboard up.
5. Switch the note to **Reading view** and tap Notes. It should flip to editing
   with the caret in place — the keyboard may need one extra tap here, which is
   known and is the only path where that is true.
6. On the Mac, press Notes in a note you are editing. Same as it was: cursor
   back where you were writing. In Reading view it should *stay* in Reading
   view, as before.
