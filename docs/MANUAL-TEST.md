# Manual test (for BarkernotBob)

Everything so far was verified from the command line. This confirms it actually works
inside Obsidian. Takes about 10 minutes.

## Setup
1. Open Obsidian (the MyVault vault).
2. Go to Settings → Community plugins.
3. Click the reload icon next to "Installed plugins".
4. Find **YT Free** in the list and turn it on.

## Test 1 — a video plays, with no ads
1. Make a new note.
2. Type three backticks, then `ytfree`, press Enter, paste any YouTube URL, press Enter,
   then type three backticks again. It should look like this:

   ````
   ```ytfree
   https://www.youtube.com/watch?v=dQw4w9WgXcQ
   ```
   ````
3. Switch to Reading view (or click outside the block in Live Preview).
4. **Expect:** briefly "Resolving stream…", then a video player appears within about
   5 seconds.
5. Press play.
6. **Expect:** the video plays immediately with no ad before it, and no ad partway
   through.

❌ If you see a yt-dlp error box, copy the text in it and send it to me.

## Test 2 — quality upgrades on its own
1. With the video from Test 1 still playing, wait about 30 seconds.
2. **Expect:** the picture gets sharper at some point, and playback continues from the
   same spot rather than jumping back to the beginning.

Note: this may be quick or may take up to a minute. It is background work, so it is fine
if it is not instant.

## Test 3 — the controls
1. Hover over the video. **Expect:** normal play/pause, scrubber, volume, fullscreen.
2. Find the Picture-in-Picture button (a small rectangle-in-rectangle icon; on some
   systems, right-click the video twice to find it in the menu).
3. Click it. **Expect:** the video pops out into a floating window that stays on top.
4. Close the floating window.

## Test 4 — timestamps
1. Open the command palette (Cmd-P) and run **YT Free: Insert timestamp at cursor**.
   - First, give it a hotkey if you want: Settings → Hotkeys → search "YT Free".
2. **Expect:** something like `[1:23](ytfree:dQw4w9WgXcQ:83)` appears in your note.
3. Play the video further, insert two or three more timestamps.
4. Switch to Reading view and click one of the timestamps.
5. **Expect:** the video jumps to that exact moment and plays.

## Test 5 — the six-hour problem
This is the one that matters most. It proves a note keeps working over time.

1. Leave the note open with the video paused, and go do something else for a while.
2. Come back and press play.
3. **Expect:** it plays. It may pause briefly and show "Refreshing stream…" first — that
   is correct behaviour, not a bug.

Faster version of the same test:
1. Start a video playing.
2. Turn your Wi-Fi off for about 10 seconds, then back on.
3. **Expect:** playback stalls, shows a refresh message, then resumes from roughly where
   it was — not from the beginning.

## Test 6 — clipping from the browser
1. Open the Obsidian Web Clipper extension → Settings → Templates → Import.
2. Choose `~/Projects/obsidian-ytfree/templates/webclipper-ytfree.json`.
3. Go to any YouTube video page and open the clipper.
4. **Expect:** the "YT Free video" template is selected automatically, and the preview
   shows a `ytfree` block.
5. Save it, then open the new note in Obsidian.
6. **Expect:** the video plays, same as Test 1.

## Test 7 — the error message is useful
1. In Terminal, run: `brew unlink yt-dlp`
2. In Obsidian, close and reopen the test note.
3. **Expect:** a clear message saying yt-dlp is not installed, showing the install
   command — not a blank box or a silent failure.
4. Put it back: `brew link yt-dlp`

## What to report
For each test, just tell me the number and what actually happened if it was not what the
"Expect" line says. Screenshots of any error box are ideal.
