# HANDOFF

Current state only; keep it under 80 lines and replace, don't append. Full history up to
2026-09-22 is in [docs/archive/HANDOFF-history-2026-09.md](docs/archive/HANDOFF-history-2026-09.md).
Ticket detail lives in `issues/NNN-*.md` (each has a Status line and a Manual test section).

## Status (2026-11-09)

- The repo is public. History was rewritten with `git filter-repo` on 2026-09-10 (Obsidian's
  `app.css`, the owner's first name and the vault name are gone from every commit).
- The plugin ships as GitHub releases. `v0.1.0` exists. `setup.sh` is the one-liner in the README.
- 2026-11-07: every open PR was merged into main at Isaiah's request ("merge all those in"),
  tested or not: #19, #20, #21, #22, #24, #27, #28, #29, #30, #40, #41. 701 unit tests pass,
  `tsc` and build clean on the combined main. Untested on a device at merge time: #19 steps 3-6,
  #20, #21's last two commits (bot-check retry, HD ready before Play), #24, #28, #30 part 2.
- 2026-11-07 nightly: #42 phone poster upgrades to `maxres2.jpg`; see the midframe scope doc.
- Isaiah's answers are in [GLOSSARY.md](GLOSSARY.md). New follow-ups are filed as GitHub issues, not as files in `issues/`.
- 2026-11-09: YouTube sign-in, cookies and account sync removed (#64); see GLOSSARY.
- 2026-11-09 nightly (#66, partial): poll rounds, HD on Play, first-run defaults, request-ceiling
  tests (`tests/request-ceilings.test.ts`, `tests/feed-schedule.test.ts`). Still open on #66:
  embed fall-through (needs #43); desktop/Preview still resolve the 360p stream at open.

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

**Focus: Obsidian store MVP** ([V1-SCOPE-MVP](docs/V1-SCOPE-MVP.md)). Issues labelled `mvp` come
first; `post-mvp` waits. New filings get an MVP call against the rule in that doc.

1. MVP path approved 2026-11-09. Order: #61, #64 → #66 → #43 → #46, #48, #65 → #25, #5 → #62.
   Decided 2026-11-09: one ad-free build for the store and Isaiah; own stream, YouTube's
   player as fallback (#43). Build split (#60) is post-MVP.
2. #43 fallback; GitHub Pages must serve the hosted player page (phone needs it).
3. #61 store compliance (LICENSE, versions.json, `x.y.z` tags, Obsidian lint: 32 errors).
4. #62 device test of merged-but-untested features; #25, #5, #46, #48; bugs Isaiah lists.

## How to ship and test

- `./install.sh` reads the vault path from a gitignored `.vault` file at the repo root (or
  `YTFREE_VAULT`). Create it once per machine. Reload Obsidian after installing.
- Release: on a clean main, `npm version X.Y.Z && git push --follow-tags`. That bumps
  `manifest.json` and `versions.json` and pushes a bare `X.Y.Z` tag (Obsidian rejects `vX.Y.Z`);
  `release.yml` lints, tests, builds and publishes it; Obsidian scans every release. `npm run lint`
  is Obsidian's own rule set; CI fails on errors.

## Gotchas

- The phone harnesses read Obsidian's `app.css` from `/tmp/ytfree-harness/app.css`. Extract it with
  the `asar` command in `tools/phone-hub-harness.mjs`. `/app.css` is gitignored; never commit it.
- `position: fixed` does not mean the viewport inside a note on a phone: `.workspace-leaf` has
  `contain: strict` and Live Preview embeds have `contain: paint`, which clip fixed children.
  Anything that must float over a note goes on `document.body` (see #52, `liftPanel`).
- Obsidian 1.10+ draws a phone modal as an inset card, not a full-width sheet. Anything laid
  out for the old sheet must size its own modal (see `.is-phone .modal.ytfree-preview-modal`).
  To compare, extract `app.css` from two releases' `obsidian-X.asar.gz` (GitHub releases of
  obsidianmd/obsidian-releases) and render with `tools/preview-sheet-harness.mjs`.
- Obsidian rewrites `community-plugins.json` from memory while it's running, so `setup.sh` only
  edits that file when Obsidian is closed.
- `npm run smoke` is a once-a-day canary (`tools/smoke.mjs`, stamps in `~/.cache/ytfree/`).
  Every live tool in `tools/` claims its own daily run through `tools/live-budget.mjs`.
- A bot check pauses all automatic YouTube requests for 45 minutes (`src/bot-check.ts`, stored in
  `localStorage` under `ytfree-bot-check-until`). Clear that key to end a pause early.
- Offline HD player: `"devOfflineHd": "<folder>"` in data.json, folder from `tools/make-offline-hd.mjs`.
- Kept answers: `localStorage` `ytfree-ytdlp-answers` / `ytfree-player-answers`. Requests: `src/request-governor.ts`.
- Desktop HD byte ranges go over Node `https`, not `requestUrl`; a request Node cannot make at
  all (no status, no byte) switches that stream to `requestUrl` for good. The loader does not
  enforce `maxTimeToFirstByteMs` (only `maxLoadTimeMs`): `requestUrl` reports no first byte.
