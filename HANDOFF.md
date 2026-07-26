# HANDOFF

## Status — 2026-07-26
v1 confirmed working in Obsidian. Issue 001 (flow capture) is **built and installed, not
yet manually verified.** All automated tests pass: 29 unit, 5 live.

## What just changed
- Issue 001 implemented: auto-timestamp on Enter, lookback offset, pause-while-typing.
  All three on by default (`lookbackSeconds: 5`, `resumeIdleMs: 2000`).
- New `src/capture.ts` holds the pure decision logic — lookback maths, the stamp gate,
  fence detection — so the part most likely to break is unit-testable without an editor.
- `src/player.ts` gained `pauseForTyping` / `resumeAfterTyping` and a `pausedByTyping`
  flag, plus `isPlaying`.
- `src/main.ts`: players are now `PlayerEntry { player, videoId, sourcePath }` so capture
  can ask "which player is in *this* note" instead of falling back to any player.
- Enter is intercepted with a `Prec.highest` CM6 keymap via `registerEditorExtension`;
  typing is detected with an `EditorView.updateListener`.
- `esbuild.config.mjs` now marks `@codemirror/*` external — verified in the built
  `main.js`.
- 18 new unit tests in `tests/capture.test.ts`.

## Exact next step
BarkernotBob runs the manual test in `issues/001-flow-capture.md` (sections A–F). Report which
numbered steps fail.

## Key decisions worth remembering
- Notes store **video IDs only**. Never write a resolved URL to disk; they expire and are
  IP-locked. This is the core design constraint.
- **The auto-stamp gate cannot be `!video.paused`.** With pause-while-typing on (the
  default), the player is already paused when Enter arrives. The gate is "playing OR
  paused-by-us". Getting this wrong silently disables auto-stamp in the default config.
  Guarded by a named regression test.
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
