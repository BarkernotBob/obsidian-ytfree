# 002 — Download a video for offline, and play the local copy

**Status:** Built 2026-07-26. 51 unit tests pass; the yt-dlp argument shape was verified
against a real 19-second download. Awaiting the manual test below.

**Created:** 2026-07-26

## Problem

Every play is a fresh yt-dlp resolve against YouTube. That is fine most of the time and
bad in four specific ways:

- **Link rot.** A video that gets deleted or privatised takes the note's usefulness with
  it. The note survives; the thing it is about does not.
- **Extraction breakage.** When YouTube changes its player, every note stops playing at
  once until `brew upgrade yt-dlp`.
- **Offline.** A plane, a bad connection, a coffee shop — no playback at all.
- **Startup cost.** ~4s to first frame, ~28s to 1080p, every single time.

For the handful of videos worth keeping, a local file fixes all four permanently.

## Solution

One command that downloads the current note's video, records it in frontmatter, and makes
the player prefer it from then on. Streaming stays the default; downloading is opt-in and
per-note.

### 1. Where the file goes — outside the vault

Default `~/Movies/YT Free/`, configurable.

**Not in the vault.** The vault is in iCloud and syncs to a second Mac; a 700MB video
inside it would sync everywhere and burn iCloud storage. A folder outside the vault means
the download is a local cache, which is the correct mental model: the note is the durable
artifact, the file is a convenience.

Filename: `<title> [<videoId>].<ext>`. The title is for a human browsing Finder; the
bracketed ID is what the plugin matches on, so renaming either the note or the file never
orphans the pairing.

### 2. How the note records it — an addition, not a replacement

```yaml
media_link: https://www.youtube.com/watch?v=abc123XYZ_  # unchanged
local_media: /Users/me/Movies/YT Free/Some Title [abc123XYZ_].mp4
```

The obvious design is to replace the URL with the file path. **Do not do this**, for three
reasons:

- Every `[3:05](ytfree:abc123XYZ_:180)` link in the note is keyed by video ID, and the ID
  is parsed out of the URL. Swap the URL for a path and every timestamp in the note goes
  dead.
- The YouTube URL is the note's provenance — where this came from, who published it.
  A local path answers neither question.
- Deleting the file to reclaim space would leave a note pointing at nothing, with no way
  to re-download.

So `media_link` stays exactly as it is and `local_media` is added beside it. The user-facing
behaviour is identical — the note now plays the downloaded copy — and nothing breaks.

### 3. How the player chooses

At mount, in order:

1. `local_media` is set **and** the file exists on disk → play the local file directly.
   No yt-dlp, no resolve, no expiry, first frame is immediate. The stream-recovery
   machinery is inert (local files do not expire).
2. Otherwise → stream, exactly as today.

Rule 1's existence check is what makes the second Mac work: the frontmatter syncs, the
file does not, so the other machine silently streams. No error, no broken note. The status
line says "Streaming — local copy not on this Mac" once, then clears.

### 4. Downloading

- Command: **YT Free: Download this video for offline**.
- A `Download` button in the player's control row, same fixed size as the others so the
  row cannot reflow. Its label swaps `Download` → `12%` → `Downloaded` in a fixed-width
  slot.
- Runs `yt-dlp` with progress on stdout (`--newline`), parsed into the existing reserved
  status line — which already has a fixed height, so progress text cannot shift the note.
- Writes to `<name>.part` and moves into place on success, so an interrupted download is
  never mistaken for a complete file.
- If the file already exists, do nothing and say so.
- The command is cancellable; cancelling kills the child process and deletes the `.part`.

### 5. ffmpeg

Anything above 360p arrives as separate video and audio streams that need ffmpeg to merge.
v1 handles this honestly rather than silently:

- ffmpeg present → download `bv*+ba/b` (best available, merged).
- ffmpeg absent → download the best **pre-muxed** format (usually 720p or 360p) and say so
  in the status line, with `brew install ffmpeg` as the fix. A worse download beats a
  failed one.

### 6. Space

Before starting, check free disk space and the video's reported size. Refuse with a clear
message under 2GB free. Warn but proceed over 2GB per file.

## In scope for v1 of this feature

- Download command + player button.
- Configurable download folder, defaulting outside the vault.
- `local_media` frontmatter written by the plugin via `processFrontMatter`.
- Player prefers a present local file; falls back to streaming when absent.
- Progress in the status line; cancel; `.part` staging.
- ffmpeg detection with a pre-muxed fallback.
- Free-space guard.
- **YT Free: Delete the local copy** — removes the file and the `local_media` key.

## Explicitly NOT v1 (→ later tickets)

- Batch / queue downloads, or "download everything in Watch Later".
- Quality picker at download time (take best available; re-download to change).
- Auto-download on note creation.
- Subtitles, thumbnails, or description sidecar files.
- Any garbage collection of files whose notes were deleted.
- Syncing the media folder between the two Macs.

## Risks

- **The vault is in iCloud.** If the user points the download folder inside it, everything
  gets worse in a way that is hard to undo. The setting warns when the chosen path is
  under the vault.
- **Disk fills up quietly.** Mitigated by the delete command; no automatic cleanup in v1,
  which is a deliberate deferral, not an oversight.
- **Legal posture is unchanged but more concrete** — a stored file is a stored file. The
  repo stays private; this does not go to the community store.

## Acceptance criteria

1. Running the download command on a Watch Later note produces a playable file in the
   configured folder and adds `local_media` to the note's frontmatter.
2. Reopening the note plays the local file — no yt-dlp process runs, and first frame is
   effectively instant.
3. Every existing `ytfree:` timestamp in that note still seeks correctly.
4. Renaming the note does not break playback. Renaming the file does not either, as long
   as the `[videoId]` suffix survives.
5. Moving the file away (simulating the second Mac) makes the note stream instead, with no
   error dialog.
6. An interrupted download leaves no file that later gets treated as complete.
7. With ffmpeg uninstalled, the download still succeeds at a pre-muxed quality and says
   why it is not higher.
8. The delete command removes both the file and the frontmatter key.
9. Pressing the Download button does not resize the control row or shift the note.

## Build notes (2026-07-26)

- `src/download.ts` holds everything testable without Obsidian: filename rules, progress
  parsing, argument construction, the `[videoId]` file search.
- **ffmpeg is not installed on this Mac.** The pre-muxed fallback is therefore the live
  path today, not a corner case — expect ~360–720p until `brew install ffmpeg`.
- Verified for real: `--print after_move:filepath --no-simulate` downloads and prints the
  final absolute path on its own line, which is how the plugin learns the extension.
- Local files play through Obsidian's `app://local/` handler. A plain `file://` URL is
  blocked by the renderer, so that is not a fallback.
- Stream recovery is disabled while playing local (`player.isLocal`); a local file's only
  failure path is one fallback to streaming.

## Manual test (for BarkernotBob)

Do these in order. Anything that doesn't match, stop and say so.

1. **Fully quit and relaunch Obsidian** (Cmd-Q). Open a Watch Later note with a video.
2. Look at the player's control row. There should be a **Download** button on the right.
3. Click it. Within a second or two a notice appears at the bottom right, counting up a
   percentage. The button label changes to that percentage too.
4. **While it downloads, watch the control row.** No button should move, resize, or shift.
   The note text below the player should not move either.
5. Let it finish. The notice should say it downloaded. If it mentions "pre-muxed quality",
   that is expected — you don't have ffmpeg installed.
6. **The video should keep playing without a hiccup** — same spot, still playing. It is now
   playing off your disk, not YouTube.
7. Open the note's frontmatter (Cmd-E to edit view, scroll to the top). There should be a
   new `local_media:` line with a path ending in `.mp4`. The `media_link:` line should be
   completely unchanged.
8. Click a timestamp link in your notes. It should still seek correctly.
9. In Finder, open `~/Movies/YT Free/`. The file should be there, named
   `<video title> [<11 characters>].mp4`.
10. Close the note and reopen it. The video should appear **instantly** — no "Resolving
    stream…" message at all.
11. **Rename the file in Finder** — change the words at the front, but leave the
    `[...]` part alone. Close and reopen the note. It should still play.
12. **Move the file to the Desktop** (simulating your other Mac, which won't have it).
    Close and reopen the note. It should play normally by streaming, with no error popup.
    Move it back afterwards.
13. Run **YT Free: Delete the local copy of this video** from the command palette. The
    file should disappear from `~/Movies/YT Free/`, and `local_media:` should vanish from
    the frontmatter.
14. Start a download again and, while it is running, run the download command a second
    time. It should cancel, and `~/Movies/YT Free/` should be left with no `.part` file.
