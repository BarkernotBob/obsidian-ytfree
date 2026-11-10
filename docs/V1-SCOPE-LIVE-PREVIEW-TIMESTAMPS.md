# V1 scope: plain timestamps tappable in Live Preview (#72)

**Status:** approved as MVP by Isaiah 2026-11-10 (option "Live Preview links").

## Problem

A description pasted by Web Clipper (or typed by hand) has plain times such as
`3:55 - Brian's new special`. Reading view turns them into pink seek links
(`linkifyRendered`, a markdown post-processor). Live Preview never did: Obsidian
runs post-processors only in Reading view. Isaiah reads and takes notes in Live
Preview on the iPhone, so those times are dead there. Markdown links
(`[3:55](ytfree:…)`, written by the hub and by flow capture) already work.

## What changes

- In Live Preview, in a note that names a video, every plain time that Reading view
  would link is drawn as a link (same pink, same `ytfree-timestamp-link` style).
- Tapping or clicking it seeks the note's player, exactly as a markdown seek link
  does: same tap-slop check, same "not while you are editing that text" guard,
  same "that video is not open in this note" notice when there is no player.
- The note's text is never changed. No file edits, nothing to sync.
- Skipped, as in Reading view: times inside markdown links, inline code and fenced
  code blocks (including the `ytfree` block). Also skipped: the frontmatter
  (`length: "01:58:43"` is not a seek).
- Off with the existing "Link timestamps in the note body" setting (`linkifyTimestamps`). Source
  mode is untouched.

## Not in v1

- Times in notes that name no video (nothing to seek).
- Transcript-jump mode for plain times; they always seek.

## Manual test (iPhone, Live Preview)

1. Open the Prisons note. The description times (`0:00 - Hot summer living`,
   `1:02:44 - When Dusty went to jail`) are pink.
2. Tap `3:55`. The player jumps to 3:55 and plays; the keyboard does not open.
3. `length: "01:58:43"` in the properties is not pink.
4. Put the cursor on a description line and type: the text edits normally.
5. Settings → turn off "Link timestamps in the note body": the times go back to plain text.
6. Repeat 2 on the Mac with a click.
