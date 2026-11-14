# HANDOFF

Current state only, under 80 lines, replace don't append. History: [docs/archive/](docs/archive/HANDOFF-history-2026-09.md).

## Status (2026-11-13)

- Public repo; history rewritten 2026-09-10 (`git filter-repo`), never re-add `app.css`.
- Ships as GitHub releases (`v0.1.0` exists; `setup.sh` is the README one-liner). Isaiah's answers
  are in [GLOSSARY.md](GLOSSARY.md); follow-ups are GitHub issues, not files in `issues/`.
- 2026-11-09: sign-in/cookies/account sync removed (#64); Subscribe + Takeout (#65); hub sync fix
  (PR #76, Mac+iPhone test pending; follow-up #75). Display name "YouTube for You", id `ytfree`.
- #66 HD on Play + ceilings (`tests/player-ceilings.test.ts`, `src/play-provider.ts`); blocked on #43.
  Bot-check Play retries 1, 5, 10, 30 min, 1 h, 2 h, 6 h ([scope](docs/V1-SCOPE-BOT-SAFE.md)).
- #48 watch history ([scope](docs/V1-SCOPE-WATCH-HISTORY.md)): device test next.
- #43 (PR #79): dead stream → next tier → YouTube's player ([scope](docs/V1-SCOPE-PLAYER-FALLBACK.md)).
- Phone YouTube-player button ([scope](docs/V1-SCOPE-YOUTUBE-TOGGLE.md)), Notes button (GLOSSARY): phone test.
- 2026-11-13 nightly (#111): age-restricted videos blocked everywhere
  ([scope](docs/V1-SCOPE-AGE-RESTRICTED.md), `src/age-restricted.ts`). Synced `ageRestricted` list;
  new feed items wait `ageCheck: "pending"` for one player call (`checkAges` in hub poll). U1/U2
  (does Restricted Mode / the content flags really drop 18+?) need the scope's device test.

## Shipped on main (scope doc = manual test)

- HD: badge, buffered band, Start in HD ([V1-SCOPE-HD-PROGRESS-AND-WAIT](docs/V1-SCOPE-HD-PROGRESS-AND-WAIT.md));
  ~55 s stutter and jumps ([V1-SCOPE-HD-STUTTER-AND-SEEK](docs/V1-SCOPE-HD-STUTTER-AND-SEEK.md), #23/#24);
  desktop HD from yt-dlp's files; per-video quality switch ([V1-SCOPE-QUALITY-SWITCH](docs/V1-SCOPE-QUALITY-SWITCH.md)).
- Phone HD (#25): native IOS HLS (~1 in 5 videos) and YouTube's own player from ⋯ → Quality
  ([V1-SCOPE-PHONE-HD](docs/V1-SCOPE-PHONE-HD.md)). Pages serves the player page from the `gh-pages`
  branch: copy `docs/player/index.html` there after each change (`npm run check` fails if it lags; docs/DEVELOPING.md).
- #91: player page logs `ad seen`/`ad ended`; no-ads device test is a release step (DEVELOPING.md).
- Keep playing on the phone, resumable background pause, Now playing button
  ([V1-SCOPE-KEEP-PLAYING](docs/V1-SCOPE-KEEP-PLAYING.md)).
- Halfway thumbnails (#41), paste-to-Preview, deep link, #29, request research: see `docs/V1-SCOPE-*`.
- **Parked:** 018 (Watch Later). Do not re-ask.

## Next step

**Focus: Obsidian store MVP** ([V1-SCOPE-MVP](docs/V1-SCOPE-MVP.md)). Issues labelled `mvp` come
first; `post-mvp` waits. New filings get an MVP call against the rule in that doc.

1. MVP order (2026-11-09): #61, #64 → #66 → #43 → #46, #48, #65 → #25, #5 → #62. One ad-free
   build; own stream, YouTube's player as fallback (#43). Build split (#60) is post-MVP.
2. #43 fallback; GitHub Pages must serve the hosted player page (phone needs it).
3. #61 store compliance (LICENSE, versions.json, `x.y.z` tags, Obsidian lint: 32 errors).
4. #62 device test of merged-but-untested features; #25, #5, #46, #48; bugs Isaiah lists.
5. Hardening ([V1-SCOPE-HARDENING](docs/V1-SCOPE-HARDENING.md)): Batches 0–2 built;
   Batch 3 (#87) waits until after release. Still open: a Windows or Linux test.
6. Channel paging + Preview → channel ([V1-SCOPE-CHANNEL-PAGING](docs/V1-SCOPE-CHANNEL-PAGING.md)):
   scope drafted 2026-11-14, awaiting Isaiah's D1-D3.

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
- `setup.sh` edits `community-plugins.json` only while Obsidian is closed. `npm run smoke`: daily
  canary; live tools claim their daily run via `scripts/live-budget.mjs`.
- A bot check pauses all automatic YouTube requests until a Play retry succeeds (retries at 1, 5,
  10, 30 min, 1 h, 2 h, then 6 h; `src/bot-check.ts`, stored in `localStorage` under
  `ytfree-bot-check-until`). Clear that key to end a pause early.
- Offline HD: `"devOfflineHd": "<folder>"` in data.json (`scripts/make-offline-hd.mjs`). Kept answers:
  `localStorage` `ytfree-ytdlp-answers` / `ytfree-player-answers`. Requests: `src/request-governor.ts`.
- `src/player.ts` uses constructor parameter properties, which Node's type stripping rejects; tests
  that import it compile it with esbuild in a load hook (see `tests/player-ceilings.test.ts`).
- Desktop HD byte ranges go over Node `https`, not `requestUrl`; a request Node cannot make at
  all (no status, no byte) switches that stream to `requestUrl` for good. The loader does not
  enforce `maxTimeToFirstByteMs` (only `maxLoadTimeMs`): `requestUrl` reports no first byte.
