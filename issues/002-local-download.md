# 002 — Download a video for offline, and play the local copy

**Status:** Scoped, not built.

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

## Manual test (for BarkernotBob)

To be written when the feature is complete, per the backlog rule.
