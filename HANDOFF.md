# HANDOFF

## Status — 2026-07-26
v1 confirmed working in Obsidian. Issue 001 (flow capture) is built and installed;
**two rounds of manual-test feedback applied, awaiting re-test.** All automated tests
pass: 38 unit, 5 live.

## What just changed (third pass)
- **Displayed time and seek target are now different numbers.** `{ts}` shows the moment
  the line was written; `{link}` / `{seconds}` point `lookbackSeconds` earlier. A line
  reading `3:05` seeks to `3:00`. Reading and replaying want different answers.
- **Enter no longer pauses the video.** Pausing moved off `updateListener` (which fires
  for Enter and for programmatic writes) onto the same `inputHandler` as stamping, so only
  real character input pauses.
- **Bulleted lines are never stamped.** Typing `-`/`*`/`+` first doesn't stamp, and a line
  already starting with a bullet doesn't either. Stamping there produced `[3:05](…) -`,
  which Obsidian won't render as a list. Accepted consequence: bulleted notes get no
  auto-timestamps — the command and Timestamp button are the fallback there.

## What changed in the second pass
- **The trigger moved from Enter to the first character typed on a line.** Enter failed
  twice in real use: the first line of a note never got stamped (you don't press Enter to
  reach it), and Enter writing text raced with the typing that followed. Now
  `EditorView.inputHandler`, and Enter is untouched.
- **Play/pause is no longer part of the stamp decision.** The old gate was "playing OR
  paused-by-us", which still skipped stamps when the user paused by hand. Replaced with a
  single `hasPlayed` guard, which exists only to stop an unplayed note stamping 0:00.
- `stampInsertOffset()` decides where the stamp goes; it fires after indentation, list
  bullets, checkboxes, quotes and headings, so auto-continued list lines still stamp.
- Player gained `hasPlayed`. `isPlaying` / `isPausedByTyping` remain but no longer gate
  stamping.

## What changed in the first pass
- Issue 001 implemented: auto-timestamp, lookback offset, pause-while-typing. All three
  on by default (`lookbackSeconds: 5`, `resumeIdleMs: 2000`).
- New `src/capture.ts` holds the pure decision logic — lookback maths, the stamp gate,
  fence detection — so the part most likely to break is unit-testable without an editor.
- `src/player.ts` gained `pauseForTyping` / `resumeAfterTyping` and a `pausedByTyping`
  flag, plus `isPlaying`.
- `src/main.ts`: players are now `PlayerEntry { player, videoId, sourcePath }` so capture
  can ask "which player is in *this* note" instead of falling back to any player.
- Typing is detected with an `EditorView.updateListener` for the pause behaviour.
- `esbuild.config.mjs` now marks `@codemirror/*` external — verified in the built
  `main.js`.
- New unit suite `tests/capture.test.ts`.

## Exact next step
Reload the plugin in Obsidian, then run the manual test in `issues/001-flow-capture.md`
(sections A–G). Section B is the one that was broken and is worth checking first.

## Key decisions worth remembering
- Notes store **video IDs only**. Never write a resolved URL to disk; they expire and are
  IP-locked. This is the core design constraint.
- **The stamp gate must not test play/pause at all.** Two versions of this were wrong:
  `!video.paused` (dead on arrival, since pause-while-typing pauses first) and then
  "playing OR paused-by-us" (still skipped stamps when the user paused by hand). The
  position is well defined in every state, so the gate doesn't ask. Guarded by a named
  regression test that also asserts no `isPlaying` field exists on the gate input.
- **The trigger is typing, not Enter.** Enter can't stamp the first line of a note, and
  an Enter that writes text races with the typing after it. Enter must also not pause —
  which is why pausing hangs off `inputHandler` and not off `updateListener`.
- **Bulleted lines carry no stamp, on purpose.** A stamp between the bullet and the text
  stops Obsidian rendering the list at all. Do not "fix" this by stamping after the
  bullet without asking — it was tried and rejected.
- **`{ts}` and `{link}` intentionally disagree.** The text shows where you were; the link
  lands `lookbackSeconds` earlier. Making them match again would undo the point.
- **`pausedByTyping` is only ever set by a pause we performed**, because `pauseForTyping`
  no-ops on an already-paused video. That is what stops the idle timer resuming a video
  the user paused themselves.
- **CodeMirror must stay external in the esbuild config.** Bundling a second copy means
  our keymap registers against a different module instance and never fires. This failure
  is silent — no error, the key just does nothing.
- Resolution timing is unstable: measured 28s cold, then ~4s warm. yt-dlp appears to
  cache its JS challenge solver. Do not treat a single slow run as a regression — re-run.
- `ios` player client is broken (returns images only). `android_vr` is the fast client
  but exposes 360p only. Both facts drove the two-stage design.

## Open risks
- 5s lookback is a guess, not a measurement. It is a slider for that reason.
- Players are keyed by video ID alone, so the same video open in two notes collapses to
  one entry (last render wins). Flow capture would target the wrong note. Edge case, left
  unfixed deliberately — see the comment on `PlayerEntry`.
- `EditorView.updateListener` fires on any doc change, not strictly on keystrokes. A sync
  or another plugin writing to the note will also pause playback.
- `npm` flagged esbuild's postinstall script as unapproved. Build works, so it was not
  needed, but a clean clone may need `npm approve-scripts`.
