import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cue } from "../src/transcript.ts";
import {
  cueTextAt,
  groupCues,
  HEATMAP_ALIASES,
  HEATMAP_HEADING,
  parseHeatmapMarkers,
  parseJson3,
  parseTranscriptCues,
  pickCaptionTrack,
  pickPlayerCaptionTrack,
  renderHeatmap,
  renderTranscript,
  topPeaks,
  transcriptIndex,
  transcriptLineAt,
  transcriptLineFor,
  isRenderedCueLine,
  TRANSCRIPT_ALIASES,
  TRANSCRIPT_HEADING,
  TRANSCRIPT_REST_MARGIN_PX,
  restingScrollTop,
  upsertSection,
  ensureFooter,
} from "../src/transcript.ts";

const ID = "h0EGCnBjTVk";

const json3 = (events: Array<[number, string[]]>) =>
  JSON.stringify({
    events: events.map(([tStartMs, segs]) => ({ tStartMs, segs: segs.map((utf8) => ({ utf8 })) })),
  });

// ------------------------------------------------------------ track picking

test("pickCaptionTrack prefers uploader captions over auto-generated", () => {
  const info = {
    subtitles: { en: [{ ext: "json3", url: "manual" }] },
    automatic_captions: { en: [{ ext: "json3", url: "auto" }] },
  };
  assert.deepEqual(pickCaptionTrack(info), { url: "manual", lang: "en", auto: false });
});

test("pickCaptionTrack falls back to auto-generated when there is nothing else", () => {
  const info = { automatic_captions: { en: [{ ext: "json3", url: "auto" }] } };
  assert.deepEqual(pickCaptionTrack(info), { url: "auto", lang: "en", auto: true });
});

test("pickCaptionTrack matches YouTube's multi-audio language keys", () => {
  // Real shape from a Mark Rober video: the only English track is `en-US-<id>`.
  const info = { subtitles: { "en-US-zsweiKMxjbg": [{ ext: "json3", url: "dubbed" }] } };
  assert.equal(pickCaptionTrack(info)?.url, "dubbed");
});

test("pickCaptionTrack takes the exact language code ahead of a suffixed one", () => {
  const info = {
    subtitles: {
      "en-US-zsweiKMxjbg": [{ ext: "json3", url: "suffixed" }],
      en: [{ ext: "json3", url: "exact" }],
    },
  };
  assert.equal(pickCaptionTrack(info)?.url, "exact");
});

test("pickCaptionTrack ignores tracks that are not json3, and unrelated languages", () => {
  assert.equal(pickCaptionTrack({ subtitles: { en: [{ ext: "vtt", url: "v" }] } }), null);
  assert.equal(pickCaptionTrack({ subtitles: { fr: [{ ext: "json3", url: "f" }] } }), null);
  assert.equal(pickCaptionTrack({}), null);
});

// ------------------------------ track picking, from an InnerTube player response

/** The shape YouTube actually returns, trimmed to the fields we read. */
const player = (tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }>) => ({
  captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
});

test("pickPlayerCaptionTrack prefers a human track over the ASR one", () => {
  const picked = pickPlayerCaptionTrack(
    player([
      { baseUrl: "https://x/api/timedtext?v=1&fmt=srv3", languageCode: "en", kind: "asr" },
      { baseUrl: "https://x/api/timedtext?v=1", languageCode: "en" },
    ]),
  );
  assert.equal(picked?.auto, false);
  assert.equal(picked?.lang, "en");
});

test("pickPlayerCaptionTrack falls back to ASR when that is all there is", () => {
  const picked = pickPlayerCaptionTrack(
    player([{ baseUrl: "https://x/api/timedtext?v=1", languageCode: "en", kind: "asr" }]),
  );
  assert.equal(picked?.auto, true);
});

test("pickPlayerCaptionTrack forces json3, replacing the client's own fmt", () => {
  // ANDROID hands back srv3 XML, which parseJson3 cannot read. This is the one
  // thing that makes the phone path work at all.
  const picked = pickPlayerCaptionTrack(
    player([{ baseUrl: "https://www.youtube.com/api/timedtext?v=1&fmt=srv3&lang=en", languageCode: "en" }]),
  );
  assert.match(picked?.url ?? "", /[?&]fmt=json3(&|$)/);
  assert.doesNotMatch(picked?.url ?? "", /fmt=srv3/);
  assert.match(picked?.url ?? "", /lang=en/);
});

test("pickPlayerCaptionTrack takes the exact language code ahead of a regional one", () => {
  const picked = pickPlayerCaptionTrack(
    player([
      { baseUrl: "https://x/regional", languageCode: "en-GB" },
      { baseUrl: "https://x/exact", languageCode: "en" },
    ]),
  );
  assert.match(picked?.url ?? "", /exact/);
});

test("pickPlayerCaptionTrack answers null for another language, or no captions", () => {
  assert.equal(pickPlayerCaptionTrack(player([{ baseUrl: "https://x/fr", languageCode: "fr" }])), null);
  assert.equal(pickPlayerCaptionTrack(player([])), null);
  assert.equal(pickPlayerCaptionTrack({}), null);
});

test("pickPlayerCaptionTrack skips a track with no usable URL", () => {
  assert.equal(pickPlayerCaptionTrack(player([{ baseUrl: "", languageCode: "en" }])), null);
});

// ------------------------------------------------------------------ parsing

test("parseJson3 joins word-level segments back into one cue", () => {
  const cues = parseJson3(json3([[1500, ["Hello", " there", " world"]]]));
  assert.deepEqual(cues, [{ seconds: 1, text: "Hello there world" }]);
});

test("parseJson3 drops the blank spacer events YouTube interleaves", () => {
  const cues = parseJson3(json3([[0, ["real"]], [500, ["\n"]], [1000, ["also real"]]]));
  assert.deepEqual(cues.map((c) => c.text), ["real", "also real"]);
});

test("parseJson3 returns nothing rather than throwing on junk", () => {
  assert.deepEqual(parseJson3("<html>not json</html>"), []);
  assert.deepEqual(parseJson3("{}"), []);
});

// ----------------------------------------------------------------- grouping

const cuesEvery = (step: number, count: number): Cue[] =>
  Array.from({ length: count }, (_, i) => ({ seconds: i * step, text: `line${i}` }));

test("groupCues collects cues into sections of about the requested length", () => {
  const paragraphs = groupCues(cuesEvery(10, 12), 60);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].seconds, 0);
  assert.equal(paragraphs[1].seconds, 60);
  assert.equal(paragraphs[0].text, "line0 line1 line2 line3 line4 line5");
});

test("groupCues starts a new section after a long gap rather than stretching one", () => {
  // A 5-minute silence must start a new section, not stretch the previous one.
  const cues: Cue[] = [
    { seconds: 0, text: "a" },
    { seconds: 300, text: "b" },
    { seconds: 310, text: "c" },
  ];
  const paragraphs = groupCues(cues, 60);
  assert.deepEqual(paragraphs.map((p) => p.seconds), [0, 300]);
});

test("groupCues timestamps land on the grid, not on the first cue's start", () => {
  const cues: Cue[] = [
    { seconds: 0, text: "a" },
    { seconds: 73, text: "b" },
  ];
  // 60, not 73: "60 seconds" means 0:00, 1:00, 2:00.
  assert.deepEqual(groupCues(cues, 60).map((p) => p.seconds), [0, 60]);
});

test("groupCues does not drift: 15 seconds gives 0, 15, 30, 45", () => {
  // Captions never start on the boundary; measuring from each section's own
  // first cue used to compound that into 0, 16, 32, 47.
  const cues: Cue[] = [
    { seconds: 1, text: "a" },
    { seconds: 16, text: "b" },
    { seconds: 31, text: "c" },
    { seconds: 46, text: "d" },
  ];
  assert.deepEqual(groupCues(cues, 15).map((p) => p.seconds), [0, 15, 30, 45]);
});

test("groupCues handles an empty transcript", () => {
  assert.deepEqual(groupCues([], 60), []);
});

// ------------------------------------------------------------------- peaks

test("topPeaks spreads the peaks out instead of returning one spike eight times", () => {
  // A single spike covers several 15s buckets; naive sorting returns all of them.
  const heatmap = [
    { start_time: 0, value: 0.1 },
    { start_time: 15, value: 0.99 },
    { start_time: 30, value: 0.98 },
    { start_time: 45, value: 0.97 },
    { start_time: 600, value: 0.9 },
  ];
  const peaks = topPeaks(heatmap, 3);
  assert.deepEqual(peaks.map((p) => p.seconds), [15, 600]);
});

test("topPeaks returns chronological order, not leaderboard order", () => {
  const heatmap = [
    { start_time: 60, value: 0.2 },
    { start_time: 300, value: 0.9 },
    { start_time: 600, value: 0.5 },
  ];
  assert.deepEqual(topPeaks(heatmap, 3).map((p) => p.seconds), [60, 300, 600]);
});

test("topPeaks drops the opening, where every viewer passes through", () => {
  // The 0:00 bucket is the tallest on almost every video and means nothing.
  const heatmap = [
    { start_time: 0, value: 1 },
    { start_time: 5, value: 0.95 },
    { start_time: 300, value: 0.4 },
  ];
  assert.deepEqual(topPeaks(heatmap, 8).map((p) => p.seconds), [300]);
});

test("topPeaks keeps a peak that starts exactly at the lead-in edge", () => {
  assert.deepEqual(topPeaks([{ start_time: 10, value: 1 }], 8).map((p) => p.seconds), [10]);
});

test("topPeaks copes with no heatmap and with a zero count", () => {
  assert.deepEqual(topPeaks(undefined, 8), []);
  assert.deepEqual(topPeaks([{ start_time: 0, value: 1 }], 0), []);
});

test("cueTextAt labels a peak with what is being said there", () => {
  const cues: Cue[] = [
    { seconds: 0, text: "intro" },
    { seconds: 100, text: "the interesting bit" },
    { seconds: 200, text: "outro" },
  ];
  assert.equal(cueTextAt(cues, 105, 100), "the interesting bit outro");
  // Before the first cue, fall back to the first cue rather than nothing.
  assert.equal(cueTextAt(cues, 0, 5), "intro");
  assert.equal(cueTextAt([], 100), "");
});

test("cueTextAt truncates on a word boundary", () => {
  const cues: Cue[] = [{ seconds: 0, text: "one two three four five six seven" }];
  const label = cueTextAt(cues, 0, 12);
  assert.equal(label, "one two…");
});

// ---------------------------------------------------------------- rendering

test("renderTranscript makes every section a seek link", () => {
  const md = renderTranscript(
    [
      { seconds: 0, text: "First." },
      { seconds: 73, text: "Second." },
    ],
    ID,
    { url: "u", lang: "en", auto: true },
  );
  assert.match(md, /Auto-generated captions \(en\), 2 sections\./);
  assert.match(md, /\*\*\[0:00\]\(ytfree:h0EGCnBjTVk:0\)\*\* First\./);
  assert.match(md, /\*\*\[1:13\]\(ytfree:h0EGCnBjTVk:73\)\*\* Second\./);
});

test("renderHeatmap lists labelled peaks, and nothing at all when there are none", () => {
  const cues: Cue[] = [{ seconds: 100, text: "the good part" }];
  const md = renderHeatmap([{ seconds: 100, value: 0.9 }], cues, ID);
  assert.equal(
    md,
    "- **[1:40](ytfree:h0EGCnBjTVk:100)** [¶](ytfree:h0EGCnBjTVk:100:t) — the good part",
  );
  assert.equal(renderHeatmap([], cues, ID), "");
});

test("renderHeatmap still lists a peak when there is no transcript to label it", () => {
  assert.equal(
    renderHeatmap([{ seconds: 60, value: 1 }], [], ID),
    "- **[1:00](ytfree:h0EGCnBjTVk:60)** [¶](ytfree:h0EGCnBjTVk:60:t)",
  );
});

// ---------------------------------------------------------- innertube heatmap

/** The shape measured on the WEB `next` response, trimmed to what is read. */
const nextResponse = (markers: Array<Record<string, unknown>>, markerType = "MARKER_TYPE_HEATMAP") => ({
  frameworkUpdates: {
    entityBatchUpdate: {
      mutations: [
        { payload: { macroMarkersListEntity: { markersList: { markerType, markers } } } },
      ],
    },
  },
});

test("parseHeatmapMarkers reads YouTube's millisecond strings as yt-dlp-shaped buckets", () => {
  const buckets = parseHeatmapMarkers(
    nextResponse([
      { startMillis: "0", durationMillis: "9370", intensityScoreNormalized: 0.4 },
      { startMillis: "121810", durationMillis: "9370", intensityScoreNormalized: 1 },
    ]),
  );
  assert.deepEqual(buckets, [
    { start_time: 0, end_time: 9.37, value: 0.4 },
    { start_time: 121.81, end_time: 131.18, value: 1 },
  ]);
});

test("parseHeatmapMarkers ignores a mutation that is not the heatmap", () => {
  assert.deepEqual(
    parseHeatmapMarkers(
      nextResponse([{ startMillis: "0", intensityScoreNormalized: 1 }], "MARKER_TYPE_CHAPTERS"),
    ),
    [],
  );
});

test("parseHeatmapMarkers answers empty for a video with no heatmap at all", () => {
  assert.deepEqual(parseHeatmapMarkers({}), []);
  assert.deepEqual(parseHeatmapMarkers({ frameworkUpdates: { entityBatchUpdate: {} } }), []);
});

test("parseHeatmapMarkers skips a marker missing its start or its value", () => {
  const buckets = parseHeatmapMarkers(
    nextResponse([
      { durationMillis: "1000", intensityScoreNormalized: 1 },
      { startMillis: "1000", durationMillis: "1000" },
      { startMillis: "2000", durationMillis: "1000", intensityScoreNormalized: 0.5 },
    ]),
  );
  assert.deepEqual(buckets, [{ start_time: 2, end_time: 3, value: 0.5 }]);
});

// ------------------------------------------------------- transcript readback

test("parseTranscriptCues reads a rendered transcript back out of a note", () => {
  const note = [
    "# Video Transcript",
    "",
    "_Auto-generated captions (en), 2 sections._",
    "",
    `**[0:00](ytfree:${ID}:0)** first words here`,
    "",
    `**[0:30](ytfree:${ID}:30)** second words here`,
    "",
  ].join("\n");
  assert.deepEqual(parseTranscriptCues(note), [
    { seconds: 0, text: "first words here" },
    { seconds: 30, text: "second words here" },
  ]);
});

test("parseTranscriptCues ignores prose, headings and hand-written timestamp links", () => {
  const note = [
    "# Notes",
    `- [12:00](ytfree:${ID}:720) a note I wrote`,
    "# Video Transcript",
    `**[1:00](ytfree:${ID}:60)** real cue`,
    `**[2:00](ytfree:${ID}:120)**`,
    "",
  ].join("\n");
  assert.deepEqual(parseTranscriptCues(note), [{ seconds: 60, text: "real cue" }]);
});

test("parseTranscriptCues on a note with no transcript is empty, not a throw", () => {
  assert.deepEqual(parseTranscriptCues(NOTE), []);
});

// ----------------------------------------------------------------- upsert

const NOTE = `---
title: "A video"
---

# Notes

my own note

# Video Description
0:00 something
`;

/** A note written before the headings were renamed and promoted to level one. */
const OLD_NOTE = `---
title: "A video"
---

## Notes

my own note

## Description
0:00 something

## Transcript
stale words
`;

test("upsertSection appends a new section without touching what is above it", () => {
  const out = upsertSection(NOTE, TRANSCRIPT_HEADING, "**[0:00](x)** hello");
  assert.match(out, /# Notes\n\nmy own note/);
  assert.match(out, /# Video Description\n0:00 something/);
  assert.match(out, /# Video Transcript\n\*\*\[0:00\]\(x\)\*\* hello/);
});

test("upsertSection replaces rather than duplicates on a second run", () => {
  const once = upsertSection(NOTE, TRANSCRIPT_HEADING, "old body");
  const twice = upsertSection(once, TRANSCRIPT_HEADING, "new body");
  assert.equal(twice.match(/# Video Transcript/g)?.length, 1);
  assert.match(twice, /# Video Transcript\nnew body/);
  assert.doesNotMatch(twice, /old body/);
});

test("upsertSection finds the old heading and leaves the new one in its place", () => {
  const out = upsertSection(OLD_NOTE, TRANSCRIPT_HEADING, "fresh words", TRANSCRIPT_ALIASES);
  assert.doesNotMatch(out, /## Transcript/);
  assert.doesNotMatch(out, /stale words/);
  assert.equal(out.match(/Transcript/g)?.length, 1);
  assert.match(out, /# Video Transcript\nfresh words/);
  // The sections it does not own are left exactly as they were.
  assert.match(out, /## Notes\n\nmy own note/);
  assert.match(out, /## Description\n0:00 something/);
});

test("upsertSection stops at the next heading, leaving later sections intact", () => {
  const withBoth = upsertSection(
    upsertSection(NOTE, HEATMAP_HEADING, "- peak"),
    TRANSCRIPT_HEADING,
    "words",
  );
  const replaced = upsertSection(withBoth, HEATMAP_HEADING, "- different peak");
  assert.match(replaced, /# Most replayed\n- different peak/);
  assert.match(replaced, /# Video Transcript\nwords/);
  assert.doesNotMatch(replaced, /- peak\n/);
});

test("upsertSection stops at a level-two heading in a note that still has them", () => {
  const out = upsertSection(OLD_NOTE, HEATMAP_HEADING, "- peak");
  const replaced = upsertSection(out, HEATMAP_HEADING, "- other peak");
  assert.match(replaced, /# Most replayed\n- other peak/);
  assert.match(replaced, /## Transcript\nstale words/);
});

test("upsertSection with an empty body removes the section instead of leaving a bare heading", () => {
  const withSection = upsertSection(NOTE, HEATMAP_HEADING, "- peak");
  const removed = upsertSection(withSection, HEATMAP_HEADING, "");
  assert.doesNotMatch(removed, /Most replayed/);
  assert.match(removed, /# Video Description/);
});

test("upsertSection puts an anchored section above the one it names", () => {
  const withTranscript = upsertSection(NOTE, TRANSCRIPT_HEADING, "words");
  const out = upsertSection(
    withTranscript,
    HEATMAP_HEADING,
    "- peak",
    HEATMAP_ALIASES,
    TRANSCRIPT_ALIASES,
  );
  assert.ok(out.indexOf(HEATMAP_HEADING) < out.indexOf(TRANSCRIPT_HEADING));
  assert.match(out, /# Most replayed\n- peak/);
  assert.match(out, /# Video Transcript\nwords/);
});

test("upsertSection with an anchor it cannot find falls back to appending", () => {
  const out = upsertSection(NOTE, HEATMAP_HEADING, "- peak", HEATMAP_ALIASES, TRANSCRIPT_ALIASES);
  assert.match(out, /# Video Description\n0:00 something\n\n# Most replayed\n- peak/);
});

test("upsertSection with an empty body on a note that never had the section is a no-op", () => {
  assert.equal(upsertSection(NOTE, HEATMAP_HEADING, ""), NOTE);
});

// ------------------------------------------------------------------- footer

test("ensureFooter ends the note with a rule and two blank lines", () => {
  const out = ensureFooter(upsertSection(NOTE, TRANSCRIPT_HEADING, "**[0:00](x)** hello"));
  assert.ok(out.endsWith("hello\n\n---\n\n\n"), JSON.stringify(out.slice(-30)));
});

test("ensureFooter does not stack a second rule on a re-fetch", () => {
  const once = ensureFooter(upsertSection(NOTE, TRANSCRIPT_HEADING, "old body"));
  const twice = ensureFooter(upsertSection(once, TRANSCRIPT_HEADING, "new body"));
  // The fixture has frontmatter rules of its own; what matters is that a
  // second pass added none.
  assert.equal(twice.match(/^---$/gm)?.length, once.match(/^---$/gm)?.length);
  assert.ok(twice.endsWith("new body\n\n---\n\n\n"));
});

test("ensureFooter leaves the note's own content alone", () => {
  const out = ensureFooter(NOTE);
  assert.match(out, /# Notes\n\nmy own note/);
  assert.match(out, /# Video Description\n0:00 something/);
});

// ------------------------------------------------- jumping to the transcript

const JUMP_NOTE = [
  "# Most replayed",
  "",
  `- **[1:40](ytfree:${ID}:100)** [¶](ytfree:${ID}:100:t) — the good part`,
  "",
  "# Video Transcript",
  "",
  `**[0:00](ytfree:${ID}:0)** opening words`,
  "",
  `**[1:20](ytfree:${ID}:80)** middle words`,
  "",
  `**[2:00](ytfree:${ID}:120)** later words`,
].join("\n");

test("transcriptLineFor lands on the paragraph covering the moment", () => {
  // 100s is inside the paragraph that starts at 80, not the one that starts at 120.
  assert.equal(transcriptLineFor(JUMP_NOTE, 100), 8);
});

test("transcriptLineFor takes the paragraph's own start exactly", () => {
  assert.equal(transcriptLineFor(JUMP_NOTE, 80), 8);
  assert.equal(transcriptLineFor(JUMP_NOTE, 120), 10);
});

test("transcriptLineFor ignores the peak list above it", () => {
  // The peaks are list items, so they can never be mistaken for a paragraph —
  // otherwise every jump would land back on the list it was clicked from.
  assert.equal(transcriptLineFor(JUMP_NOTE, 0), 6);
});

test("transcriptLineFor answers null with no transcript, or before the first line", () => {
  assert.equal(transcriptLineFor("# Notes\n\nnothing here", 100), null);
  assert.equal(transcriptLineFor(`**[0:10](ytfree:${ID}:10)** words`, 5), null);
});

// --------------------------------------------- following the video in the note

test("transcriptIndex reads every paragraph once, and no peak", () => {
  assert.deepEqual(transcriptIndex(JUMP_NOTE), [
    { seconds: 0, line: 6 },
    { seconds: 80, line: 8 },
    { seconds: 120, line: 10 },
  ]);
});

test("transcriptIndex is empty for a note with no transcript", () => {
  assert.deepEqual(transcriptIndex("# Notes\n\nnothing here"), []);
});

test("transcriptLineAt gives the same answers as a fresh scan of the note", () => {
  const index = transcriptIndex(JUMP_NOTE);
  for (const at of [0, 79, 80, 100, 119, 120, 9999]) {
    assert.equal(transcriptLineAt(index, at), transcriptLineFor(JUMP_NOTE, at));
  }
  assert.equal(transcriptLineAt(index, -1), null);
});

test("isRenderedCueLine tells a transcript paragraph from a timestamp you typed", () => {
  assert.equal(isRenderedCueLine(`**[1:20](ytfree:${ID}:80)** middle words`), true);
  // The default stamp format: a bare link, no bold.
  assert.equal(isRenderedCueLine(`[1:20](ytfree:${ID}:80) my own note`), false);
  // A most-replayed row, which is a list item.
  assert.equal(isRenderedCueLine(`- **[1:40](ytfree:${ID}:100)** — the good part`), false);
  assert.equal(isRenderedCueLine("# Video Transcript"), false);
});

// ------------------------------------------- where the current line comes to rest

/** A transcript region: 400pt of window onto 4000pt of paragraphs. */
const REGION = { scrollTop: 0, scrollHeight: 4000, clientHeight: 400 };

test("the current line rests just under the top of its region, not in the middle", () => {
  // 040: the line was being centred, which spends the upper half of the region
  // on words already heard. `offsetFromTop` is measured from the region's own
  // top edge, so whatever is pinned above it is already accounted for.
  const box = { ...REGION, scrollTop: 1000 };
  assert.equal(restingScrollTop(box, 250), 1000 + 250 - TRANSCRIPT_REST_MARGIN_PX);
});

test("a line already at the top does not jump", () => {
  const box = { ...REGION, scrollTop: 1000 };
  assert.equal(restingScrollTop(box, TRANSCRIPT_REST_MARGIN_PX), 1000);
});

test("a line above the region scrolls back up to it", () => {
  const box = { ...REGION, scrollTop: 1000 };
  assert.equal(restingScrollTop(box, -300), 1000 - 300 - TRANSCRIPT_REST_MARGIN_PX);
});

test("it bottoms out cleanly rather than scrolling past the end", () => {
  // The last paragraphs cannot reach the top — there is nothing behind them to
  // scroll up. Asking for it must land on the last full screen, not on blank
  // space below the transcript.
  const box = { ...REGION, scrollTop: 3500 };
  assert.equal(restingScrollTop(box, 380), 4000 - 400);
});

test("it never goes above the start of the transcript", () => {
  assert.equal(restingScrollTop({ ...REGION, scrollTop: 0 }, 0), 0);
  assert.equal(restingScrollTop({ ...REGION, scrollTop: 4 }, 0), 0);
});

test("a region shorter than its contents is not scrolled at all", () => {
  // A three-line transcript in a tall region: nothing to scroll, and the answer
  // is 0 rather than a negative scrollTop the browser would silently clamp.
  const short = { scrollTop: 0, scrollHeight: 300, clientHeight: 400 };
  assert.equal(restingScrollTop(short, 120), 0);
});
