# HANDOFF

Current state only; keep it under 80 lines and replace, don't append. Full history up to
2026-09-22 is in [docs/archive/HANDOFF-history-2026-09.md](docs/archive/HANDOFF-history-2026-09.md).
Ticket detail lives in `issues/NNN-*.md` (each has a Status line and a Manual test section).

## Status (2026-10-13)

- The repo is public. History was rewritten with `git filter-repo` on 2026-09-10 (Obsidian's
  `app.css`, the owner's first name and the vault name are gone from every commit).
- The plugin ships as GitHub releases. `v0.1.0` exists. `setup.sh` is the one-liner in the README.
- 635 unit tests pass, `tsc` clean, build clean (2026-10-13).
- Isaiah's answers of 2026-10-13 are recorded in [GLOSSARY.md](GLOSSARY.md): every ticket built
  up to 046 passed its manual test, 018 is parked, 045's scope is approved, 049 is built
  (blockquote), and collab videos (GitHub #2) come from the signed-in subscription feed.
- New follow-ups are filed as GitHub issues from now on, not as files in `issues/`.

## Tickets

- **Built 2026-10-13 on PR #4, awaiting manual test:** 045 (channel screen), GitHub #2 (collab
  videos), 048 (feed backfill), 047 (search blocklist and Hide channel), GitHub #3 (YouTube links
  open in Obsidian, [docs/V1-SCOPE-URL-HANDOFF.md](docs/V1-SCOPE-URL-HANDOFF.md)). Each has a
  manual test in its issue file or scope doc.
- **Scoped, not built:** 005 (mobile full quality, unblocked), 043 (desktop full quality).
- **Parked:** 018 (Watch Later). Do not re-ask.

## Next step

1. Isaiah: run `npm run smoke` on the Mac. `tests/channel.smoke.ts` checks the two live shapes
   built blind: the Videos-tab continuation (page 2) and the WEB player's `publishDate` (048).
   If either fails, fix the parser in `src/channel.ts` before merging.
2. Isaiah: run the manual tests for 045, #2, 048, 047, #3, and 049 (re-import the clipper
   template first). Then merge PR #4.
3. After merge: 005 or 043, whichever Isaiah picks.

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
- The smoke test's quality lookup only prints `HLS: yes/no` (GitHub #17). `HLS: no` is normal
  signed out (issue 043); it fails only if there's no https URL with an `expire` field.
- `PROGRESS_TTL_DAYS` stays 365 on purpose (decided 2026-09-02).
