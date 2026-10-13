# HANDOFF

Current state only; keep it under 80 lines and replace, don't append. Full history up to
2026-09-22 is in [docs/archive/HANDOFF-history-2026-09.md](docs/archive/HANDOFF-history-2026-09.md).
Ticket detail lives in `issues/NNN-*.md` (each has a Status line and a Manual test section).

## Status (2026-10-13)

- The repo is public. History was rewritten with `git filter-repo` on 2026-09-10 (Obsidian's
  `app.css`, the owner's first name and the vault name are gone from every commit).
- The plugin ships as GitHub releases. `v0.1.0` exists. `setup.sh` is the one-liner in the README.
- 573 unit tests pass, `tsc` clean, build clean (2026-10-13).
- Isaiah's answers of 2026-10-13 are recorded in [GLOSSARY.md](GLOSSARY.md): every ticket built
  up to 046 passed its manual test, 018 is parked, 045's scope is approved, 049 is built
  (blockquote), and collab videos (GitHub #2) are caught from each channel's Videos tab.
- New follow-ups are filed as GitHub issues from now on, not as files in `issues/`.

## Tickets

- **Building now, in this order:** 045 (channel screen) → GitHub #2 (collab videos, reuses 045's
  browse call) → 048 (backfill, same call) → 047 (search blocklist).
- **Scoped, not built:** YouTube links open in Obsidian
  ([docs/V1-SCOPE-URL-HANDOFF.md](docs/V1-SCOPE-URL-HANDOFF.md)), 005 (mobile full quality,
  unblocked), 043 (desktop full quality).
- **Parked:** 018 (Watch Later). Do not re-ask.

## Next step

1. Record live InnerTube channel responses with `node tools/record-channel-fixtures.mjs` on a
   machine that reaches youtube.com (the cloud sandbox cannot). They are the fixtures 045 and #2
   are built against.
2. Build 045, then #2. Measure the Videos-tab response size before choosing #2's poll cadence;
   Isaiah's condition is "as long as this isn't too resource intensive".
3. Isaiah: re-import the Web Clipper template and run 049's manual test.

## How to ship and test

- `./install.sh` reads the vault path from a gitignored `.vault` file at the repo root (or
  `YTFREE_VAULT`). Create it once per machine. Reload Obsidian after installing.
- Release: bump `manifest.json`'s version, `npm run check`, then
  `gh release create vX.Y.Z main.js manifest.json styles.css --title vX.Y.Z --notes "…"`.
  Re-running `setup.sh` (or BRAT) picks it up.

## Gotchas

- The phone harnesses read Obsidian's `app.css` from `/tmp/ytfree-harness/app.css`. Extract it with
  the `asar` command in `tools/phone-hub-harness.mjs`. `/app.css` is gitignored; never commit it.
- Obsidian rewrites `community-plugins.json` from memory while it's running, so `setup.sh` only
  edits that file when Obsidian is closed.
- `PROGRESS_TTL_DAYS` stays 365 on purpose (decided 2026-09-02).
