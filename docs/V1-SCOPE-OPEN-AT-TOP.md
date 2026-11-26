# V1 scope: notes and Previews open at the top, nothing selected

**Written:** 2026-11-12, from Isaiah's request that day: "right now video notes and preview opens
on transcript opened. I need it to open preview with neither selected. Note just opens at the
top of the note and NOT with the keyboard opened." MVP.

## Today (main bd069ef)

- **Preview:** on a phone the Transcript region starts open; off a phone the Description does.
  If the transcript is missing, the Description is opened in its place.
- **Video note:** Description, Most replayed and Transcript start folded, but nothing puts the
  note back at the top, so it can open wherever it was left (for example in the transcript,
  after "Transcript" or "This moment"). A note made by the hub's Watch button opens with the
  cursor in Notes and the editor focused, which raises the phone keyboard.

## v1

1. **Preview opens with neither region open**, phone and desktop: Description and Transcript
   both shut, buttons at the foot of the sheet. A missing transcript no longer opens the
   Description. Tapping a header opens it as before.
2. **A video note opens at the top**, every time it is opened into a pane (from the hub, a link,
   search, recent files). Folds as today. Any transcript follow from before is stopped.
3. **No keyboard on open.** Watch no longer focuses the editor for a new note. On a phone, if
   the editor has focus right after the note opens, it is blurred, unless the Notes button was
   tapped since.
4. Switching back to a tab where the note is already open does not move it.

## Not in v1

- Remembering the last place per note (the opposite of this ask).
- Hub button on the note's bar (separate item, needs a mockup).
