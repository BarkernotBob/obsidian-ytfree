# 024 — Preview plays

Status: **Built 2026-07-31 — awaiting manual test.**

Stage three of [docs/V1-SCOPE-CARD-CONTROLS.md](../docs/V1-SCOPE-CARD-CONTROLS.md):
the Preview modal gains a real ad-free player, on search results and on hub
cards alike. Stage two — the persistent search blocklist and Hide channel — is
still not built; it is independent of this.

## The problem

Preview answered "what is this video" with words: title, channel, numbers and
the whole description. For a stranger's video that is not the question. The
question is whether the first thirty seconds are worth twenty minutes, and the
only way to answer it was still to press Watch — which makes a note, which is
the note spam the four buttons were built to stop.

## What was built

**A player at the top of the sheet.** The same engine the note fence and the
pinned player use — `buildPlayer`, one code path, so recovery, quality
upgrades, resume and Smart Speed cannot drift between the three surfaces.

**Minus everything note-shaped**, because those have nothing to act on rather
than to make Preview feel lesser:

| Withheld | Why |
|---|---|
| Download | writes a path into a note's frontmatter |
| Section jumps | a preview has no sections |
| Pin | a control over a note's own header |
| Timestamp capture | there is nowhere to put a stamp |

Smart Speed, silence skipping, seek, speed, drag-seek and the pop-out all work.

**Preview records the position and not the watch stamp.** `ProgressStore` now
has `recordPosition` alongside `record`; the two halves were already separate
functions in `progress.ts`, so this is a call site, not a rule. Because the
store keys by `videoId` and never by note path, a preview and a later watch are
one session in two containers.

**One player at a time, enforced twice.** Mounting a preview tears down any
previous one and pauses a note player showing the same video. Pressing **Watch**
inside the sheet closes it *before* running the action — closing destroys the
player, destroying reports the final position, and only then does the note open
and ask where to resume. The other order gives you two streams and a stale
position.

**The preview player is not in the `players` map.** It is a field of its own.
The map is keyed by video ID and every note feature reaches through it, so a
preview registered there would evict the entry of a note showing the same video
and break timestamp capture, the pinned player and section jumps — then delete
that note's player on the way out. The three places that legitimately want
*every* live player now iterate `livePlayers()`, and the two that wanted "the
settings for this player" look up by player identity (`entryOf`) rather than by
video ID.

**The slot is 16:9 before it holds anything.** An unloaded `<video>` is zero
pixels tall; without the reserved box the sheet would be a title and three
buttons until the stream resolved and then grow under the pointer. A failure to
resolve draws a same-height message rather than collapsing.

## Deviations from the scope, and why

- **A downloaded local copy is not used by Preview.** `local_media` is recorded
  in a note's frontmatter and looked up by note path; a preview has no path, so
  it streams. Playing the local file would mean a reverse lookup from video to
  note purely to save a resolve on videos you have already downloaded — which
  are exactly the ones you have already decided about.
- **The description box is shorter** (40vh → 22vh). The picture plus a page of
  text put the buttons off the bottom of a laptop screen.

## Acceptance criteria

1. Preview, from a search result or a hub card, plays the video ad-free inside
   the modal.
2. The sheet does not change height when the video finishes resolving.
3. Smart Speed, seek and the speed control work inside Preview; there is no
   pin, no download and no section row.
4. Watching part of a video in Preview and then pressing **Watch** opens the
   note with the player picking up where the preview stopped.
5. Only one thing ever plays: pressing Watch leaves no audio behind, and
   previewing a video already open in a note pauses the note's copy.
6. A previewed video does not count as watched — it shows the red progress line
   on its card, but Preview alone never stamps it.
7. Closing the sheet stops playback and the download of the stream.
8. A video that cannot be resolved shows a message in the player's place, and
   the rest of the sheet still works.

## Manual test (for BarkernotBob)

**On the desktop**

1. Open the hub, press the YouTube button, search for something.
2. Click a result's picture (not a button). The sheet should open with a black
   16:9 box at the top, then the video should start in it. Nothing on the sheet
   should move down when it does.
3. Let it play a few seconds. Check the control bar: speed, Smart Speed and the
   ⋯ pop-out should be there; there should be **no** pin and **no** download
   button, and no row of section links.
4. Drag the scrubber, change the speed, open the pop-out and change something.
   All of it should behave as it does in a note.
5. Press **Save** in the sheet. It should tick and the sheet should stay open,
   with the video still playing.
6. Play to about a minute in, then press **Watch**. The sheet should close, the
   note should open, and its player should pick up at roughly that minute —
   not at the start.
7. Listen: after the sheet closes there must be exactly one thing playing. No
   double audio, no audio continuing from a closed sheet.
8. Go back to the hub. Preview a *different* video, play thirty seconds, then
   close the sheet with Escape. The audio must stop immediately.
9. That video's card should now have a red line along the foot of its
   thumbnail — but it should not have gained a note.
10. Open a video note with a pinned player and start it playing. Go to the hub
    and preview that same video. The note's player should pause rather than
    keep playing under the sheet.

**On the phone**

11. Open the hub on the iPhone and tap a card's picture. The sheet should show
    the video's thumbnail with a ▶ over it in a 16:9 box.
12. Tap it. It should resolve and play, and the sheet's layout should not jump.
13. Swipe left and right across the picture — it should seek, not open
    Obsidian's sidebar.
14. Press Watch and check the same thing as step 6: the note picks up where the
    preview stopped.

**The one that would be easy to miss**

15. Preview a video, let it play, then press **Remove**. The sheet should close
    and the audio should stop.
