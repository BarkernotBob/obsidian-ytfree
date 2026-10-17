# HANDOFF

Current state only; keep it under 80 lines and replace, don't append. Full history up to
2026-09-22 is in [docs/archive/HANDOFF-history-2026-09.md](docs/archive/HANDOFF-history-2026-09.md).
Ticket detail lives in `issues/NNN-*.md` (each has a Status line and a Manual test section).

## Status (2026-10-16)

- The repo is public. History was rewritten with `git filter-repo` on 2026-09-10 (Obsidian's
  `app.css`, the owner's first name and the vault name are gone from every commit).
- The plugin ships as GitHub releases. `v0.1.0` exists. `setup.sh` is the one-liner in the README.
- 653 unit tests pass, `tsc` clean, build clean (2026-10-16, PR #12 merged with main).
- Isaiah's answers of 2026-10-13 are recorded in [GLOSSARY.md](GLOSSARY.md): every ticket built
  up to 046 passed its manual test, 018 is parked, 045's scope is approved, 049 is built
  (blockquote), and collab videos (GitHub #2) come from the signed-in subscription feed.
- New follow-ups are filed as GitHub issues from now on, not as files in `issues/`.

## Tickets

- **Built 2026-10-14 on branch `claude/project-thread-zamhn2`, awaiting manual test:**
  GitHub #8 (Preview fullscreen on the phone) and #9 (Fullscreen waits for the stream).
- **Scoped 2026-10-14, awaiting Isaiah's approval:** GitHub #10 (paste a URL, land in its
  Preview) and #11 (every YouTube link lands in Preview), one scope:
  [docs/V1-SCOPE-PASTE-TO-PREVIEW.md](docs/V1-SCOPE-PASTE-TO-PREVIEW.md).
- **Built 2026-10-13 (PR #4, merged):** 045, GitHub #2, 048, 047, GitHub #3. Manual tests are in
  each issue file or scope doc.
- **Scoped, not built:** 005 (mobile full quality, unblocked), 043 (desktop full quality).
- **Built 2026-10-15, manual test passed 2026-10-15, PR #14 (merged):** desktop plays without yt-dlp, and stitched HD
  (043, plus 005 as an opt-in phone setting). Scope and manual test:
  [docs/V1-SCOPE-STREAM-WITHOUT-YTDLP-AND-HD.md](docs/V1-SCOPE-STREAM-WITHOUT-YTDLP-AND-HD.md).
  Code: `src/adaptive.ts` (pure), `src/virtual-loader.ts`, `src/hd.ts`, providers in `main.ts`.
- **Parked:** 018 (Watch Later). Do not re-ask.

## Next step

1. Isaiah: on the iPhone, open any Preview. The picture starts right under the status bar with
   the ✕ on its top-right corner; opening Description or Transcript widens it to full width and
   hides the other, shutting it puts both back side by side (#8, PR #12). Mac unchanged.
2. Isaiah: on the iPhone, press Play then Fullscreen at once. The Fullscreen button is dimmed
   and the status line says it will be ready once the video has loaded; nothing changes size.
   Press it again once the video plays: the phone's own fullscreen. Same in a note (#9).
3. Isaiah: approve or change the #10/#11 scope, and answer its one question. Then build it.
4. Backlog for HD is on GitHub (quality picker / ABR, InnerTube-first on desktop).

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
- `PROGRESS_TTL_DAYS` stays 365 on purpose (decided 2026-09-02).
