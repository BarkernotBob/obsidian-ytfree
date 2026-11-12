# HANDOFF

Current state only; keep it under 80 lines and replace, don't append. Full history up to
2026-09-22 is in [docs/archive/HANDOFF-history-2026-09.md](docs/archive/HANDOFF-history-2026-09.md).
Ticket detail lives in `issues/NNN-*.md` (each has a Status line and a Manual test section).

## Status (2026-11-09)

- Public repo; history rewritten 2026-09-10 (`git filter-repo`), never re-add `app.css`.
- The plugin ships as GitHub releases. `v0.1.0` exists. `setup.sh` is the one-liner in the README.
- Isaiah's answers are in [GLOSSARY.md](GLOSSARY.md). New follow-ups are filed as GitHub issues, not as files in `issues/`.
- 2026-11-09: YouTube sign-in, cookies and account sync removed (#64); see GLOSSARY.
- 2026-11-09 (#66, PR #67): HD on Play and ceiling tests (#70); torture test showed no need for
  poll rounds; nothing before Play on desktop; bot-check retries on Play (1, 5, 10, 30 min, 1 h,
  2 h, 6 h); savings G1–G5; embed rule waits for #43 ([scope](docs/V1-SCOPE-BOT-SAFE.md)).
- 2026-11-10 nightly (#66): Play/HD ceilings tested end to end through the real player
  (`tests/player-ceilings.test.ts`, provider now in `src/play-provider.ts`). #66 is blocked on #43 only.
- #48 watch history (PR #74, #77; [scope](docs/V1-SCOPE-WATCH-HISTORY.md)). Next: device test. #43 must feed it.
- 2026-11-09: Subscribe inside YT Free + Takeout steps (#65, `src/subscribe.ts`).
- 2026-11-09: hub/watch-time sync fix merged (PR #76; docs/V1-SCOPE-SYNC.md). Next: Isaiah's
  Mac+iPhone test. Follow-up #75.

- 2026-11-10 (#43, PR #79): a dead stream link moves playback to the next tier, ending in
  YouTube's player in place ([V1-SCOPE-PLAYER-FALLBACK](docs/V1-SCOPE-PLAYER-FALLBACK.md)); brew messages gone.

- 2026-11-10: one-tap YouTube player button on the phone bar
  ([V1-SCOPE-YOUTUBE-TOGGLE](docs/V1-SCOPE-YOUTUBE-TOGGLE.md)). Next: iPhone test; if YouTube
  needs a tap to start with sound, try a muted start then unmute in `docs/player/index.html`.
- 2026-11-11: Notes button reworked (see GLOSSARY): keyboard-only fold, cursor at the bottom of
  Notes, other YT Free buttons close the keyboard. Next: Isaiah's phone test.

- 2026-11-12: subscription management scoped ([V1-SCOPE-MANAGE-SUBSCRIPTIONS](docs/V1-SCOPE-MANAGE-SUBSCRIPTIONS.md)):
  remove/add channels from the hub sidebar, unsubscribe, channel from a note. Next: Isaiah's MVP call (D1), then build.

- 2026-11-10: display name is now "YouTube for You"; plugin id stays `ytfree` (GLOSSARY).

## Shipped on main (scope doc = manual test)

- HD: badge, buffered band, Start in HD ([V1-SCOPE-HD-PROGRESS-AND-WAIT](docs/V1-SCOPE-HD-PROGRESS-AND-WAIT.md));
  ~55 s stutter and jumps ([V1-SCOPE-HD-STUTTER-AND-SEEK](docs/V1-SCOPE-HD-STUTTER-AND-SEEK.md), #23/#24);
  desktop HD from yt-dlp's files; per-video quality switch ([V1-SCOPE-QUALITY-SWITCH](docs/V1-SCOPE-QUALITY-SWITCH.md)).
- Phone HD (#25): native IOS HLS (~1 in 5 videos) and YouTube's own player from ⋯ → Quality
  ([V1-SCOPE-PHONE-HD](docs/V1-SCOPE-PHONE-HD.md)). Part 2 needs GitHub Pages on, serving `/docs` from main.
- Keep playing on the phone, resumable background pause, Now playing button
  ([V1-SCOPE-KEEP-PLAYING](docs/V1-SCOPE-KEEP-PLAYING.md)).
- Halfway thumbnails (#41), paste-to-Preview, hub deep link, pasteable videos (#29), request
  research — each has a `docs/V1-SCOPE-*` / `docs/RESEARCH-*` doc.
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
5. Hardening ([V1-SCOPE-HARDENING](docs/V1-SCOPE-HARDENING.md)): Batches 0–2 built;
   Batch 3 (#87) waits until after release. Still open: a Windows or Linux test.

## How to ship and test

- `./install.sh` reads the vault path from a gitignored `.vault` file at the repo root (or
  `YTFREE_VAULT`). Create it once per machine. Reload Obsidian after installing.
- Release: on a clean main, `npm version X.Y.Z && git push --follow-tags`. That bumps
  `manifest.json` and `versions.json` and pushes a bare `X.Y.Z` tag (Obsidian rejects `vX.Y.Z`);
  `release.yml` lints, tests, builds and publishes it; Obsidian scans every release. `npm run lint`
  is Obsidian's own rule set; CI fails on errors.

## Gotchas

- The phone harnesses read Obsidian's `app.css` from `/tmp/ytfree-harness/app.css`. Extract it with
  the `asar` command in `scripts/phone-hub-harness.mjs`. `/app.css` is gitignored; never commit it.
- `position: fixed` does not mean the viewport inside a note on a phone: `.workspace-leaf` has
  `contain: strict` and Live Preview embeds have `contain: paint`, which clip fixed children.
  Anything that must float over a note goes on `document.body` (see #52, `liftPanel`).
- Obsidian 1.10+ draws a phone modal as an inset card, not a full-width sheet. Anything laid
  out for the old sheet must size its own modal (see `.is-phone .modal.ytfree-preview-modal`).
  To compare, extract `app.css` from two releases' `obsidian-X.asar.gz` (GitHub releases of
  obsidianmd/obsidian-releases) and render with `scripts/preview-sheet-harness.mjs`.
- `setup.sh` edits `community-plugins.json` only while Obsidian is closed (it rewrites it from memory).
- `npm run smoke`: daily canary; every live tool claims its daily run via `scripts/live-budget.mjs`.
- A bot check pauses all automatic YouTube requests until a Play retry succeeds (retries at 1, 5,
  10, 30 min, 1 h, 2 h, then 6 h; `src/bot-check.ts`, stored in `localStorage` under
  `ytfree-bot-check-until`). Clear that key to end a pause early.
- Offline HD player: `"devOfflineHd": "<folder>"` in data.json, folder from `scripts/make-offline-hd.mjs`.
- Kept answers: `localStorage` `ytfree-ytdlp-answers` / `ytfree-player-answers`. Requests: `src/request-governor.ts`.
- `src/player.ts` uses constructor parameter properties, which Node's type stripping rejects; tests
  that import it compile it with esbuild in a load hook (see `tests/player-ceilings.test.ts`).
- Desktop HD byte ranges go over Node `https`, not `requestUrl`; a request Node cannot make at
  all (no status, no byte) switches that stream to `requestUrl` for good. The loader does not
  enforce `maxTimeToFirstByteMs` (only `maxLoadTimeMs`): `requestUrl` reports no first byte.
