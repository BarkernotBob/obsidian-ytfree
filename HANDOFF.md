# HANDOFF

## Status — 2026-07-26 (latest)
Note-shape pass: properties collapse, in-note player retired, description with
clickable chapters. 58 unit tests pass, build clean, installed to the vault.
**Awaiting manual test (see below).**

## What just changed
- **Properties collapse on video notes.** Opening a note whose frontmatter names
  a video folds the properties table, so the pinned player and the note text are
  what you land on. Obsidian's own collapse toggle is clicked rather than the
  `is-collapsed` class being set, so its internal state and the arrow agree and
  the first click to re-open works. Done once per note per view — expanding by
  hand sticks until you open a different note. Off switch in settings.
- **No more in-note player.** The ```ytfree fence is gone from the Templater
  template and both Web Clipper templates; the pinned player is the only player.
  The fence still works for notes that already have one (it renders the stub).
- **`## Description` with clickable chapters.** Bare `mm:ss` / `h:mm:ss` text in
  a note that names a video renders as a seek link into the pinned player, using
  the same `ytfree:<id>:<secs>` scheme flow capture writes. This lives in the
  plugin, not the templates, because the Web Clipper can copy a description but
  cannot rewrite it — and doing it at render time also fixes notes clipped
  before today.
  - The Templater template additionally writes **real markdown links** into the
    file, because it has the video ID at creation time and a link in the source
    survives the plugin being off.
  - `src/description.ts` holds the matcher: guards keep `1:02:03` from also
    yielding `02:03`, keep decimals like `1.5:30` out, and skip anything already
    inside a markdown link.
- **Templater now scrapes the watch page.** oEmbed carries no description, so
  `shortDescription` and `lengthSeconds` are read out of the page HTML. Failure
  is non-fatal: the note is created with the description section empty.

## Next step
Manual test:
1. Relaunch Obsidian (new `main.js`).
2. New note from `Templates/8.Watch_Later_Template.md`, paste a URL for a video
   that has chapters. Expect: properties collapsed, one player at the top, no
   fence, `## Description` populated with clickable timestamps.
3. Click a chapter timestamp — the pinned player should seek there.
4. Expand properties by hand, scroll, switch tabs and come back — they should
   stay expanded until you open a different note.
5. Re-import `System Templates/Obsidian Clipper - Watch Later (YT Free).json`
   into Web Clipper, clip a video, confirm the same shape.

## Previous status — 2026-07-26
Issue 002 (offline download) built and installed. 51 unit tests pass; the yt-dlp
argument shape was verified against a real 19-second download. **Awaiting the
14-step manual test in `issues/002-local-download.md`.**

A pickup note for the download work also lives in the vault at
`MyVault/YT Free — Offline Download Plan.md`, per BarkernotBob's request.

## What just changed (issue 002)
- **Download button + two commands.** Downloads the note's video to
  `~/Movies/YT Free/`, writes `local_media:` into the frontmatter, and swaps the
  running player onto the file at the same position — the swap is invisible.
- **`media_link` is never replaced.** Timestamps are keyed by video ID parsed out
  of that URL; replacing it with a path would kill every `ytfree:` link in the
  note, lose provenance, and make re-download impossible.
- **Files live outside the vault** (iCloud). That means frontmatter syncs to the
  second Mac and the file does not, so that Mac silently streams. Deliberate.
- **`<title> [<videoId>].mp4`.** If the recorded path is gone, the folder is
  searched for the bracketed ID, so renaming in Finder is harmless.
- **No ffmpeg on this Mac**, so the pre-muxed fallback is the live path today,
  not a corner case. Downloads say so rather than failing.
- Local playback goes through Obsidian's `app://local/` handler; `file://` is
  blocked by the renderer. A bad local file falls back to streaming once.
- `src/download.ts` isolates everything testable without Obsidian.

## Next step
Manual test (issue 002). Relaunch Obsidian first.

## Previous status — 2026-07-26 (later)
Pinned player shipped and installed; ad-hoc playlist URLs now resolve.
All automated tests pass: 41 unit, 5 live. **Awaiting manual test.**

## What just changed
- **Pinned player.** When a note's frontmatter names a YouTube video
  (`media_link`, then `url` — configurable), the full player mounts above the
  note body inside `.view-content` and stays put while the note scrolls. This
  replaces the Media Notes plugin, which owned that spot and has been disabled
  in the vault's `community-plugins.json`.
- Same player as the fenced block — controls, speed, PiP, timestamp, stream
  recovery — because both now go through one `buildPlayer()`.
- A ```ytfree fence whose video is already pinned renders a one-line stub
  instead of a second player, so nothing double-buffers or fights over the
  `players` map key.
- Height is a fixed `vh` from settings, not content-driven: nothing the player
  does can reflow the note text under it.
- `syncPinnedPlayers()` is idempotent and reconciles on layout-change,
  active-leaf-change, file-open and metadata changes; an `isConnected` check
  catches Obsidian rebuilding a view's DOM underneath us.
- **`watch_videos?video_ids=a,b,c` parses.** YouTube's ad-hoc playlist URL names
  no single video, so `extractVideoIds()` returns the whole queue and
  `extractVideoId()` takes the first. Handles `%2C` and plain commas.

## Next step
Manual test in Obsidian (relaunch first — Media Notes only stays off after a
restart): open a Watch Later note, confirm one player at the top, confirm
timestamps still stamp and seek, confirm no double player under the fence.

## Previous status — 2026-07-26
v1 confirmed working in Obsidian. Issue 001 (flow capture) is built and installed;
**two rounds of manual-test feedback applied, awaiting re-test.** All automated tests
pass: 39 unit, 5 live.

## What just changed (third pass)
- **Displayed time and seek target are now different numbers.** `{ts}` shows the moment
  the line was written; `{link}` / `{seconds}` point `lookbackSeconds` earlier. A line
  reading `3:05` seeks to `3:00`. Reading and replaying want different answers.
- **Enter no longer pauses the video.** Pausing moved off `updateListener` (which fires
  for Enter and for programmatic writes) onto the same `inputHandler` as stamping, so only
  real character input pauses.
- **On bulleted lines the stamp waits for the first word.** Typing `-`/`*`/`+` doesn't
  stamp, and neither does whitespace, so the bullet is typed clean and Obsidian renders
  the list; the stamp then arrives with the text: `- [3:05](…) text`. An earlier pass
  skipped bulleted lines entirely — that was wrong, they should stamp.

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
- **Never stamp on the bullet character or on whitespace.** A stamp before the bullet
  stops Obsidian rendering the list; a stamp on the space strands the text after it. The
  correct trigger on a list line is the first word.
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
