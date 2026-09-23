# HANDOFF

Current state only; keep it under 80 lines and replace, don't append. Full history up to
2026-09-22 is in [docs/archive/HANDOFF-history-2026-09.md](docs/archive/HANDOFF-history-2026-09.md).
Ticket detail lives in `issues/NNN-*.md` (each has a Status line and a Manual test section).

## Status (2026-09-22)

- The repo is public. History was rewritten with `git filter-repo` on 2026-09-10 (Obsidian's
  `app.css`, the owner's first name and the vault name are gone from every commit).
- The plugin ships as GitHub releases. `v0.1.0` exists. `setup.sh` is the one-liner in the README.
- Last build (2026-09-02): 573 unit tests pass, `tsc` clean, build clean.

## Tickets

- **About 27 built and waiting on Isaiah's manual test:** 001, 007–015, 017, 019–021, 023, 024,
  026, 028, 029, 037–042 (phone), 044, 046. This is the bottleneck, not build speed.
- **Not built:** 004 → 005 (mobile viewer), 016 (partly built), 022, 043, 045 → 048, 047, 049.
- **Waiting on a decision from Isaiah:**
  - 045: react to the scope in [docs/V1-SCOPE-CHANNEL-SCREEN.md](docs/V1-SCOPE-CHANNEL-SCREEN.md).
    048 is blocked until then.
  - 049: is the Obsidian Web Clipper still part of the workflow? If not, deleting `templates/` is
    the whole fix.
  - 018: needs a decision (see the issue).

## Next step

1. Isaiah: run the manual tests, oldest first. 044 and 046 need the iPhone for their second half.
   Tell Claude which already pass so their Status can move to done.
2. Answer 045 and 049 (one line each).
3. Then build 047, or 048 once 045 is answered.

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
