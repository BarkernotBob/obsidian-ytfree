# HANDOFF

Current state only, under 80 lines, replace don't append. History: [docs/archive/](docs/archive/HANDOFF-history-2026-09.md).

## Status (2026-11-26)

- **0.2.0 was the first store release; 0.2.1 is listed with a Caution label** (all MVP work merged: #46 search, #62 device pass, #104–#123).
  Isaiah phone-tested the integrated build before release. Display name "YouTube for You", id `ytfree`.
- Public repo; history rewritten 2026-09-10 (`git filter-repo`), never re-add `app.css`.
- Isaiah's answers are in [GLOSSARY.md](GLOSSARY.md); follow-ups are GitHub issues, not files in `issues/`.
- GitHub Pages serves the player page from the `gh-pages` branch: copy `docs/player/index.html`
  there after each change (`npm run check` fails if it lags; docs/DEVELOPING.md).
- #91: player page logs `ad seen`/`ad ended`; no-ads device test is a release step (DEVELOPING.md).
- Scope docs (`docs/V1-SCOPE-*.md`) double as manual tests. **Parked:** 018 (Watch Later); do not re-ask.

## Next step

1. 0.2.2 is out and the store scan shows 0 warnings (Caution label gone). Remaining scan
   "Recommendations": `display`/`setDynamicTooltip`/`setWarning` (kept for Obsidian < 1.13,
   Isaiah's choice), `virtual-loader` `timeout`, and the Vault enumeration / Clipboard /
   localStorage behaviors.
2. Settings as native sub-pages + README rewrite (docs/V1-SCOPE-SETTINGS-PAGES.md) merged
   (#140, Isaiah device-tested). Store description: its own thread.
3. UI polish: Cinema design language picked (docs/V1-SCOPE-CINEMA-UI.md, includes #133).
4. Then post-MVP backlog (label `post-mvp`): #125 manage-filter ×, #87 Batch 3, #86 Windows/Linux
   test, #118/#119 channel lists. Dependabot PRs #101/#113 after release.

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
