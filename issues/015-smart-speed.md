# 015 — Smart Speed: compress pauses like Overcast

Status: **Scoped 2026-07-29 — not built.** Scope and design decisions live in
[docs/V1-SCOPE-SMART-SPEED.md](../docs/V1-SCOPE-SMART-SPEED.md).

BarkernotBob: *"Research what I could do to implement a smart speed like in Overcast …
I want it to be usable without downloading anything further like ffmpeg, but then
that's an addition that adds features. But if FFMPEG is required for use, that's
a no go."*

## The one-paragraph version

Pauses in speech play at ~3×, speech plays at the chosen speed, pitch stays
normal. One engine in the player consumes a **silence map** (windows of
`[start, end]` seconds); three interchangeable producers make maps: caption-gap
timing (no dependencies, desktop **and** mobile — this is the baseline a
stranger gets), ffmpeg `silencedetect` on the audio-only stream (desktop, only
if ffmpeg is found, more accurate, streams — nothing downloads to disk), and
maps synced from the other device through the vault. The real-time Web Audio
route is closed — googlevideo only grants CORS to youtube.com, measured
2026-07-29 — which is why maps, not live analysis.

## Build order

1. Apply layer in `player.ts` + rate decision function + toggle & time-saved
   readout (space reserved — no layout reflow).
2. Transcript producer: keep json3 durations (`dMs`) the parser currently
   discards; gaps > 0.5 s → windows with entry/exit margins baked in.
3. Map store `silence-maps.json` — save is a merge (014's lesson), union by
   video ID, ffmpeg beats transcript.
4. ffmpeg producer: resolver-style discovery, spawn on audio-only URL, parse
   stderr progressively, feed the live player, kill on close. Local downloads
   (002) analyzed directly.

## Acceptance criteria

1. Fresh vault, no ffmpeg, no yt-dlp: captioned video compresses pauses with
   normal pitch, time-saved climbs — desktop and iPhone.
2. Toggle off → engine never touches `playbackRate`.
3. ffmpeg installed → map upgrades mid-playback; quiet-music sections are not
   compressed.
4. No captions + no ffmpeg → toggle dims with an explanation, no errors.
5. Mac-computed map syncs to the phone and is used there.
6. Toggling moves no neighboring control.
7. Unit tests: stderr parser, gap→window builder, rate decision, map merge.

## Manual test (for BarkernotBob)

Written when the issue is completed.
