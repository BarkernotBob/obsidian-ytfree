# HANDOFF

Current state only; keep it under 80 lines and replace, don't append. Full history up to
2026-09-22 is in [docs/archive/HANDOFF-history-2026-09.md](docs/archive/HANDOFF-history-2026-09.md).
Ticket detail lives in `issues/NNN-*.md` (each has a Status line and a Manual test section).

## Status (2026-11-07)

- The repo is public. History was rewritten with `git filter-repo` on 2026-09-10 (Obsidian's
  `app.css`, the owner's first name and the vault name are gone from every commit).
- The plugin ships as GitHub releases. `v0.1.0` exists. `setup.sh` is the one-liner in the README.
- 2026-11-07: every open PR was merged into main at Isaiah's request ("merge all those in"),
  tested or not: #19, #20, #21, #22, #24, #27, #28, #29, #30, #40, #41. 701 unit tests pass,
  `tsc` and build clean on the combined main. Untested on a device at merge time: #19 steps 3-6,
  #20, #21's last two commits (bot-check retry, HD ready before Play), #24, #28, #30 part 2.
- Isaiah's earlier answers are recorded in [GLOSSARY.md](GLOSSARY.md).
- New follow-ups are filed as GitHub issues, not as files in `issues/`.

## Shipped on main (scope doc = manual test)

- HD: badge, buffered band, Start in HD ([V1-SCOPE-HD-PROGRESS-AND-WAIT](docs/V1-SCOPE-HD-PROGRESS-AND-WAIT.md));
  ~55 s stutter and jumps ([V1-SCOPE-HD-STUTTER-AND-SEEK](docs/V1-SCOPE-HD-STUTTER-AND-SEEK.md), #23/#24);
  desktop HD from yt-dlp's files; per-video quality switch ([V1-SCOPE-QUALITY-SWITCH](docs/V1-SCOPE-QUALITY-SWITCH.md)).
- Phone HD (#25): native IOS HLS (~1 in 5 videos) and YouTube's own player from ⋯ → Quality
  ([V1-SCOPE-PHONE-HD](docs/V1-SCOPE-PHONE-HD.md)). Part 2 needs GitHub Pages on, serving `/docs` from main.
- Keep playing on the phone, resumable background pause, Now playing button
  ([V1-SCOPE-KEEP-PLAYING](docs/V1-SCOPE-KEEP-PLAYING.md)).
- Halfway-point thumbnails (#41), paste/click a link to land in Preview
  ([V1-SCOPE-PASTE-TO-PREVIEW](docs/V1-SCOPE-PASTE-TO-PREVIEW.md)), hub deep link
  ([V1-SCOPE-HUB-DEEP-LINK](docs/V1-SCOPE-HUB-DEEP-LINK.md)), lock spike pasteable videos (#29),
  request-volume research ([RESEARCH-YOUTUBE-REQUESTS](docs/RESEARCH-YOUTUBE-REQUESTS.md)).
- **Parked:** 018 (Watch Later). Do not re-ask.

## Next step

1. Isaiah: install main and run the untested scope-doc tests listed under Status.
2. Phone HD part 2: switch GitHub Pages to main `/docs` (it pointed at PR #28's branch).
3. Request volume: backlog #31–#39, first #31 (stop after a bot check) and #39 (smoke canary).
   No live probes from Isaiah's network until then.
4. HD backlog on GitHub: rung picker / ABR (#15).

## How to ship and test

- `./install.sh` reads the vault path from a gitignored `.vault` file at the repo root (or
  `YTFREE_VAULT`). Create it once per machine. Reload Obsidian after installing.
- Release: bump `manifest.json`'s version, `npm run check`, then
  `gh release create vX.Y.Z main.js manifest.json styles.css --title vX.Y.Z --notes "…"`.
  Re-running `setup.sh` (or BRAT) picks it up.

## Gotchas

- The phone harnesses read Obsidian's `app.css` from `/tmp/ytfree-harness/app.css`. Extract it with
  the `asar` command in `tools/phone-hub-harness.mjs`. `/app.css` is gitignored; never commit it.
- Obsidian 1.10+ draws a phone modal as an inset card, not a full-width sheet. Anything laid
  out for the old sheet must size its own modal (see `.is-phone .modal.ytfree-preview-modal`).
  To compare, extract `app.css` from two releases' `obsidian-X.asar.gz` (GitHub releases of
  obsidianmd/obsidian-releases) and render with `tools/preview-sheet-harness.mjs`.
- Obsidian rewrites `community-plugins.json` from memory while it's running, so `setup.sh` only
  edits that file when Obsidian is closed.
- The smoke test's quality lookup only prints `HLS: yes/no` (GitHub #17). `HLS: no` is normal
  signed out (issue 043); it fails only if there's no https URL with an `expire` field.
- Desktop HD byte ranges go over Node `https`, not `requestUrl`; a request Node cannot make at
  all (no status, no byte) switches that stream to `requestUrl` for good. The loader does not
  enforce `maxTimeToFirstByteMs` (only `maxLoadTimeMs`): `requestUrl` reports no first byte.
- `PROGRESS_TTL_DAYS` stays 365 on purpose (decided 2026-09-02).
