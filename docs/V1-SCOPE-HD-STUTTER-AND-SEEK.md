# V1 scope: the ~55 s stutter and slow jumps in HD

Isaiah, 2026-10-22, Mac and iPhone: "At right about 55 seconds, almost every video pauses for a
moment, then the audio and video slightly change when it boots again", and a jump "sometimes
seems to be really long, a lot longer than base youtube would take."

## Cause (inference, not yet measured on a live video)

The only thing that pauses playback and then changes picture *and* sound is a source swap. The
swap that fires on its own is the stitched HD stream's fatal-error path: `attach()` falls back to
360p, which has the 360p file's own sound. What can make HD go fatal near 55 s on most videos:
YouTube serving the opening of a stream URL and refusing the rest. NewPipe hit exactly this with
URLs issued without an anti-bot token ("HTTP 403 errors at the 1:09 timestamp"). The resolve only
ever read the index and the first segment, so it could not see it. With 30 s buffered ahead, a
refusal around 1:20 to 1:25 runs the buffer dry at about 55 s. Then hls.js's default retry
ladder applies: six tries up to 8 s apart, and up to two minutes per load.

A jump past the refused point hits the same ladder before anything plays, which fits "sometimes
really long": short jumps land inside what is buffered or what is served, and long ones don't.

`tools/hd-probe.ts` measures this on a live video (resolve time, per-client segment status at 0
to 180 s). It has not reported back yet. If it shows something else, this scope changes.

## v1

1. **Check deep at resolve.** After the indexes, read 1 KB of the segment at or past 90 s for the
   top rung and the sound. If either is refused, that client's pair is skipped and the next
   client gets a turn (then the HLS manifest, then 360p stays). This happens while 360p is
   already playing, so a refusal costs nothing visible.
2. **Re-link instead of failing.** When a segment is refused mid-play (403, 404 or 410), ask the
   clients again for the same files (same itag, same language), read the failed range from the
   first answer that serves it, and move every track to the fresh links. hls.js sees one slow
   segment, not an error. If no client serves it, the error goes through and later refusals
   don't trigger the asking again.
3. **Short retries.** For stitched streams only: up to 2 retries 0.5 to 1 s apart, a 30 s cap per
   load, and 1 timeout retry. A dead HD stream now falls back to 360p in seconds, not a minute.

## Not in v1 (follow-ups as GitHub issues)

- Cancelling a superseded segment download after a jump. `requestUrl` cannot be aborted, so an
  abandoned 1080p segment keeps using bandwidth while the landing segment loads.
- Real time-to-first-byte and progress from the loader (needs a streaming request on desktop),
  so hls.js's bandwidth estimate and its abandon rule work from facts.

## Manual test

On the Mac and on the iPhone (HD on), with any video longer than 3 minutes that you have not
opened today:

1. Press Play and let it run past 1:30 without touching it. Expected: no pause at around 55 s,
   and the picture and sound don't change. The status line never says "HD unavailable, back
   to 360p".
2. Drag the scrubber to about two thirds of the way in. Expected: playback resumes within about
   2 s, maybe soft for a moment, then sharp again.
3. Jump back to 0:20, then forward to 1:10. Expected: each resumes within about 2 s.
