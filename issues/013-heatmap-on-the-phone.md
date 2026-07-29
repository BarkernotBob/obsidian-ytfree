# 013 — Most-replayed moments on the phone, and backfilled without asking

Status: **Built 2026-07-29 — awaiting manual test.**

BarkernotBob: *"develop so mobile pulls in the top moments as well, or that it
automatically comes in on first desktop open no manual command."*

Both, as it turns out. The phone writes the section itself now, and an older
note that missed out gets it filled in the next time it is opened — on either
platform, with no command.

---

## The limitation in 012 was mine, not YouTube's

[012](012-resume-transcript-and-controls.md) shipped saying replay peaks could
not work on a phone: the heatmap only existed in yt-dlp's info JSON, and
InnerTube's `next` response had no `heatMarker` and weighed 10.5 MB. The second
half of that was right about the wrong client and the first half was looking for
the wrong key. The heatmap is not a `heatMarker` renderer any more — it is an
entity mutation:

```
frameworkUpdates.entityBatchUpdate.mutations[]
  .payload.macroMarkersListEntity.markersList
    .markerType === "MARKER_TYPE_HEATMAP"
    .markers[] { startMillis, durationMillis, intensityScoreNormalized }
```

Probed live across five clients and two endpoints before anything was written:

| client | `next` size | markers |
| --- | --- | --- |
| **WEB** | **1.0 MB** | **100** |
| ANDROID | 13 MB | 100 |
| IOS | 11 MB | 100 |
| MWEB, TVHTML5, ANDROID_VR, WEB_EMBEDDED_PLAYER | — | 0 |

The `player` endpoint carries none on any client. So WEB is both the client that
answers and the cheapest one that could, and the 1 MB is the decompressed
figure — **67,204 bytes on the wire**, measured with curl. Once per note, not
once per view. That is a defensible number on a phone; 13 MB would not have been.

The UA matters as much as the context: a WEB `clientName` paired with an iPhone
User-Agent gets MWEB's answer, which has no heatmap. Both live in `CLIENTS.web`
together with a comment saying so.

## What runs now

**On a fetch (either platform).** `harvestWithInnertube` fires the caption call
and the heatmap call in parallel, and the heatmap's failure is swallowed: peaks
are the garnish, the transcript is the meal, and a `next` endpoint that changes
shape must not cost the note its transcript. The command is one name on both
platforms again — *Fetch transcript and most-replayed moments* — because it now
does the same thing on both.

**On open, for notes that missed it.** `queueHeatmapBackfill` runs on
`file-open` for any note naming a video that has a transcript and no
most-replayed section. One request, no notice unless it has something to add,
and it never touches the transcript.

Peaks still need labels, and re-downloading a caption file to label eight of
them would be paying twice for words already in the file — so
`parseTranscriptCues` reads the note's own rendered transcript back out. Labels
land on the paragraph interval rather than the caption line, which is a few
seconds' slack against a bucket that is ten seconds wide anyway.

The section goes **above** the transcript, where a fresh fetch would have put
it, via a new optional `anchor` argument to `upsertSection` — appending it after
five thousand words of transcript would have been technically correct and
useless.

**One honest cost:** "already checked" is remembered in memory, not on disk. A
video with no heatmap — most videos — spends one 67 KB request per session in
which you open its note. Writing a "we checked" marker into the note would put
churn into a synced file for a fact worth 67 KB a session, which is the wrong
trade.

## Tests

- 9 new unit tests: `parseHeatmapMarkers` (real marker shape, wrong marker type,
  absent heatmap, malformed markers), `parseTranscriptCues` (readback, prose and
  hand-written stamps ignored, no transcript), `upsertSection` anchoring.
- 1 new live smoke test: the WEB `next` response still carries
  `MARKER_TYPE_HEATMAP`, with >50 buckets that are not flat.
- `npm run check`: **220 tests**, build clean. `npm run smoke`: **11/11**.

---

## Acceptance criteria

- [x] A video note created on the phone gets a **Most replayed** section with no
      command run.
- [x] A heatmap failure leaves the transcript intact.
- [x] An existing note with a transcript and no heatmap gains one on next open,
      on either platform, with no command.
- [x] Backfilled peaks are labelled with what is being said there.
- [x] The backfilled section sits above the transcript, not below it.
- [x] A note that already has both is not re-fetched or rewritten.
- [x] The command has one name on both platforms; the mobile settings blurb no
      longer claims peaks are desktop-only.
- [x] `npm run check` clean (220 tests), `npm run smoke` 11/11.

## Manual test (for BarkernotBob)

On the phone. Force-download the vault and fully relaunch Obsidian.

1. Open the hub and open a **video you have not opened before** — a popular one,
   since only popular videos have a heatmap at all. Wait a few seconds.
2. The note should get a **Most replayed** list *and* a **Video Transcript**,
   with the replay list **above** the transcript. Each peak should be a
   timestamp followed by what is said there.
3. Tap one of the peaks. The player should jump to that moment.
4. Find an **older note on the phone** — one made before today that has a
   transcript but no "Most replayed". Close it if it is open, then open it.
   Within a few seconds you should see a *"added N replay peaks"* notice and the
   section should appear above the transcript.
5. Close that note and open it again. **Nothing should happen** — no notice, no
   second section, no change to the file.
6. Open a note for an obscure video (few views). It should stay exactly as it
   is — no empty "Most replayed" heading.

Then on the Mac:

7. Open an old video note that has a transcript and no replay list. Same as
   step 4: it should fill in by itself, no command.
8. Run **Fetch transcript and most-replayed moments** on any video note. It
   should replace both sections rather than duplicating either.
