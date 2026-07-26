# HANDOFF

## Status — 2026-07-26
v1 built, installed to the MyVault vault, **not yet manually verified in Obsidian.**
All automated tests pass. The next action is BarkernotBob's manual test.

## What just changed
- Gates cleared first: `docs/RED-TEAM.md` (verdict: build, narrower than it looked) and
  `docs/V1-SCOPE.md`.
- Plugin implemented: `ytfree` code block → ad-free `<video>` with native controls + PiP,
  timestamp insert/seek commands, settings tab.
- Two-stage loading added after measurement showed a cold high-quality resolve can take
  ~28s. Playback now starts at 360p in ~4s and upgrades to 1080p HLS in the background,
  preserving position.
- Regression suites: 11 unit tests (`npm test`), 5 live tests (`npm run smoke`). All green.
- Installed via `./install.sh` to `<vault>/.obsidian/plugins/ytfree`.

## Exact next step
BarkernotBob runs the manual test in `docs/MANUAL-TEST.md`. Report which steps fail.

Nothing else should be built until real playback in Obsidian is confirmed — every
verification so far is from the command line, not from inside the app.

## Key decisions worth remembering
- Notes store **video IDs only**. Never write a resolved URL to disk; they expire and are
  IP-locked. This is the core design constraint.
- Resolution timing is unstable: measured 28s cold, then ~4s warm. yt-dlp appears to
  cache its JS challenge solver. Do not treat a single slow run as a regression — re-run.
- `ios` player client is broken (returns images only). `android_vr` is the fast client
  but exposes 360p only. Both facts drove the two-stage design.
- The vault already has `media-extended` installed. It does not conflict, but it is the
  fallback if this project dies.

## Open risks
- Not yet run inside Obsidian at all — Electron may reject something (hls.js worker,
  child_process spawn under the plugin sandbox).
- `npm` flagged esbuild's postinstall script as unapproved. Build works, so it was not
  needed, but a clean clone may need `npm approve-scripts`.
