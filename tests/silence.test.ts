import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineSilence,
  compressibleWindows,
  createSilencedetectStream,
  emptySilenceState,
  isBetterMap,
  mergeWindows,
  offsetWindows,
  planChunks,
  spliceAtFrontier,
  unionWindows,
  isStale,
  LEAD_IN_SECONDS,
  LEAD_OUT_SECONDS,
  mergeSilenceMaps,
  normalizeSilenceState,
  parseSilencedetect,
  pruneSilenceMaps,
  rateFor,
  secondsSaved,
  secondsSkipped,
  subtractWindows,
  moveFor,
  MIN_SKIP_SECONDS,
  windowsFromCues,
} from "../src/silence.ts";
import type { PlaybackWindow, SilenceMap } from "../src/silence.ts";
import { parseJson3, parseJson3Timed } from "../src/transcript.ts";

const ID = "dQw4w9WgXcQ";
const OTHER = "aBcDeFgHiJk";

function map(over: Partial<SilenceMap> = {}): SilenceMap {
  return {
    videoId: ID,
    source: "transcript",
    computedAt: "2026-07-29T12:00:00.000Z",
    minGap: 0.5,
    windows: [{ start: 10, end: 12 }],
    ...over,
  };
}

// ------------------------------------------------------ gap → window builder

test("a gap longer than the floor becomes a window", () => {
  const windows = windowsFromCues(
    [
      { start: 0, end: 2, text: "one" },
      { start: 5, end: 6, text: "two" },
    ],
    0.5,
  );
  assert.deepEqual(windows, [{ start: 2, end: 5 }]);
});

test("a gap shorter than the floor is not a pause", () => {
  const windows = windowsFromCues(
    [
      { start: 0, end: 2, text: "one" },
      { start: 2.3, end: 3, text: "two" },
    ],
    0.5,
  );
  assert.deepEqual(windows, []);
});

test("the floor is the setting, not a constant", () => {
  const cues = [
    { start: 0, end: 2, text: "one" },
    { start: 2.3, end: 3, text: "two" },
  ];
  assert.equal(windowsFromCues(cues, 0.5).length, 0);
  assert.equal(windowsFromCues(cues, 0.2).length, 1);
});

test("silence before the first word is a window too", () => {
  const windows = windowsFromCues([{ start: 8, end: 9, text: "hello" }], 0.5);
  assert.deepEqual(windows, [{ start: 0, end: 8 }]);
});

test("overlapping auto-caption cues do not invent a pause", () => {
  // The rolling two-line style: each event starts before the one before it has
  // finished. Compared pairwise this reports negative gaps and then misses the
  // real one; against a running maximum it gets both right.
  const windows = windowsFromCues(
    [
      { start: 0, end: 4, text: "one" },
      { start: 2, end: 6, text: "one two" },
      { start: 5, end: 9, text: "two three" },
      { start: 12, end: 14, text: "after the pause" },
    ],
    0.5,
  );
  assert.deepEqual(windows, [{ start: 9, end: 12 }]);
});

test("a cue with no stated duration borrows the next start rather than inventing silence", () => {
  const windows = windowsFromCues(
    [
      { start: 0, end: 0, text: "one" },
      { start: 3, end: 4, text: "two" },
    ],
    0.5,
  );
  assert.deepEqual(windows, []);
});

test("cues arriving out of order are still measured in order", () => {
  const windows = windowsFromCues(
    [
      { start: 5, end: 6, text: "two" },
      { start: 0, end: 2, text: "one" },
    ],
    0.5,
  );
  assert.deepEqual(windows, [{ start: 2, end: 5 }]);
});

// ----------------------------------------------------------- the apply layer

test("margins are trimmed off both ends of a window", () => {
  const [window] = compressibleWindows([{ start: 10, end: 14 }], 0.5);
  assert.equal(window.start, 10 + LEAD_IN_SECONDS);
  assert.equal(window.end, 14 - LEAD_OUT_SECONDS);
});

test("filtering happens on the raw length, before the margins", () => {
  // 0.5 s exactly: the user asked for it, so it survives the filter even though
  // the margins leave only a quarter of a second to compress.
  assert.equal(compressibleWindows([{ start: 1, end: 1.5 }], 0.5).length, 1);
  assert.equal(compressibleWindows([{ start: 1, end: 1.49 }], 0.5).length, 0);
});

test("a window the margins swallow is dropped rather than inverted", () => {
  assert.deepEqual(compressibleWindows([{ start: 1, end: 1.2 }], 0.1), []);
});

test("raising the setting re-filters the same map with no recompute", () => {
  const raw = [
    { start: 1, end: 1.6 },
    { start: 10, end: 14 },
  ];
  assert.equal(compressibleWindows(raw, 0.5).length, 2);
  assert.equal(compressibleWindows(raw, 1).length, 1);
});

test("rate is the silence rate inside a window and the base rate outside", () => {
  const windows = [{ start: 10, end: 12 }];
  assert.equal(rateFor(9.9, windows, 1, 3), 1);
  assert.equal(rateFor(10, windows, 1, 3), 3);
  assert.equal(rateFor(11.9, windows, 1, 3), 3);
  assert.equal(rateFor(12, windows, 1, 3), 1);
});

test("a pause never slows anyone down", () => {
  // Listening at 4×: the pause rate of 3× would be a brake, so the base wins.
  assert.equal(rateFor(10.5, [{ start: 10, end: 12 }], 4, 3), 4);
});

test("no windows means the base rate, always", () => {
  assert.equal(rateFor(10, [], 1.5, 3), 1.5);
});

test("the right window is found among many", () => {
  const windows = Array.from({ length: 500 }, (_, i) => ({ start: i * 10, end: i * 10 + 2 }));
  assert.equal(rateFor(4001, windows, 1, 3), 3);
  assert.equal(rateFor(4005, windows, 1, 3), 1);
});

test("time saved is listening time, not wall time", () => {
  // One wall second at 3× covers three seconds of video, which would have taken
  // three seconds at 1×. Two seconds saved.
  assert.equal(secondsSaved(1, 1, 3), 2);
  assert.equal(secondsSaved(1, 1, 1), 0);
  assert.equal(secondsSaved(1, 2, 4), 1);
});

// ------------------------------------------------------------------ staleness

test("a coarser map cannot answer a finer question", () => {
  assert.equal(isStale(map({ minGap: 0.5 }), 0.2), true);
  assert.equal(isStale(map({ minGap: 0.5 }), 0.5), false);
  assert.equal(isStale(map({ minGap: 0.5 }), 1), false);
});

test("float noise in a stored setting does not make a map stale", () => {
  assert.equal(isStale(map({ minGap: 0.5000000000000001 }), 0.5), false);
});

// ---------------------------------------------------------------- the merge

test("the two producers never compete for one slot", () => {
  // 015 ranked ffmpeg above transcript and kept one map per video. 016 keeps
  // both, because they answer different questions and playback wants the union
  // — so a cross-source comparison is never an upgrade, in either direction.
  const ffmpeg = map({ source: "ffmpeg", computedAt: "2020-01-01T00:00:00.000Z" });
  const transcript = map({ source: "transcript", computedAt: "2026-07-29T12:00:00.000Z" });
  assert.equal(isBetterMap(ffmpeg, transcript), false);
  assert.equal(isBetterMap(transcript, ffmpeg), false);
});

test("a complete map beats a partial one, and a longer partial beats a shorter", () => {
  // The 015 bug this exists to stop: a note closed twenty seconds in stored a
  // twenty-second map that then answered for the whole video forever.
  const complete = map({ source: "ffmpeg" });
  const partial = map({ source: "ffmpeg", analyzedTo: 20, computedAt: "2026-07-30T00:00:00.000Z" });
  assert.equal(isBetterMap(partial, complete), false);
  assert.equal(isBetterMap(complete, partial), true);
  assert.equal(isBetterMap(map({ source: "ffmpeg", analyzedTo: 300 }), partial), true);
});

test("within one source, a finer floor beats a coarser one", () => {
  assert.equal(isBetterMap(map({ minGap: 0.2 }), map({ minGap: 0.5 })), true);
  assert.equal(isBetterMap(map({ minGap: 0.5 }), map({ minGap: 0.2 })), false);
});

test("and only then does recency decide", () => {
  const older = map({ computedAt: "2026-07-01T00:00:00.000Z" });
  const newer = map({ computedAt: "2026-07-29T00:00:00.000Z" });
  assert.equal(isBetterMap(newer, older), true);
  assert.equal(isBetterMap(older, newer), false);
});

test("a merge adds the other device's videos instead of replacing them", () => {
  // 014's lesson: the phone loaded the file, the Mac added a video, and a
  // whole-file write from the phone would delete it.
  const onDisk = emptySilenceState();
  mergeSilenceMaps(onDisk, [map({ videoId: OTHER })]);

  const fromPhone = map({ videoId: ID });
  assert.equal(mergeSilenceMaps(onDisk, [fromPhone]), true);
  assert.deepEqual(Object.keys(onDisk.maps).sort(), [OTHER, ID].sort());
});

test("a merge that changes nothing reports no change", () => {
  const state = emptySilenceState();
  mergeSilenceMaps(state, [map()]);
  assert.equal(mergeSilenceMaps(state, [map()]), false);
});

test("pruning drops the oldest and keeps the cap", () => {
  const state = emptySilenceState();
  for (let i = 0; i < 5; i++) {
    mergeSilenceMaps(state, [
      map({ videoId: `v${i}`, computedAt: `2026-07-0${i + 1}T00:00:00.000Z` }),
    ]);
  }
  assert.equal(pruneSilenceMaps(state, 3), true);
  assert.deepEqual(Object.keys(state.maps).sort(), ["v2", "v3", "v4"]);
  assert.equal(pruneSilenceMaps(state, 3), false);
});

test("a half-synced file loses only the entries that are broken", () => {
  const state = normalizeSilenceState({
    maps: {
      [ID]: map(),
      bad1: { source: "guesswork", computedAt: "x", minGap: 1, windows: [] },
      bad2: { source: "ffmpeg", minGap: 1, windows: [] },
      bad3: null,
    },
  });
  assert.deepEqual(Object.keys(state.maps), [ID]);
});

test("windows that are not windows are dropped, and the rest are sorted", () => {
  const state = normalizeSilenceState({
    maps: {
      [ID]: map({
        windows: [
          { start: 10, end: 12 },
          { start: 1, end: 2 },
          { start: 5, end: 5 },
          { start: 8, end: 7 },
          { start: 3 },
        ] as never,
      }),
    },
  });
  assert.deepEqual(state.maps[ID].sources.transcript?.windows, [
    { start: 1, end: 2 },
    { start: 10, end: 12 },
  ]);
});

test("a file that is not a state file starts empty", () => {
  assert.deepEqual(normalizeSilenceState(null), emptySilenceState());
  assert.deepEqual(normalizeSilenceState("nonsense"), emptySilenceState());
});

// --------------------------------------------------------- ffmpeg stderr

const FFMPEG_STDERR = `
ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers
  Stream #0:0: Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s
[silencedetect @ 0x14f605c30] silence_start: 12.3457
[silencedetect @ 0x14f605c30] silence_end: 13.4561 | silence_duration: 1.1104
[silencedetect @ 0x14f605c30] silence_start: 61.02
[silencedetect @ 0x14f605c30] silence_end: 61.85 | silence_duration: 0.83
size=N/A time=00:40:12.00 bitrate=N/A speed=88.4x
`;

test("silencedetect pairs are read out of everything else ffmpeg says", () => {
  assert.deepEqual(parseSilencedetect(FFMPEG_STDERR), [
    { start: 12.3457, end: 13.4561 },
    { start: 61.02, end: 61.85 },
  ]);
});

test("a start with no end — a killed analysis — yields nothing", () => {
  const text = "[silencedetect @ 0x1] silence_start: 12.3\n";
  assert.deepEqual(parseSilencedetect(text), []);
});

test("a negative start clamps to zero rather than being dropped", () => {
  const text = "silence_start: -0.001\nsilence_end: 2.5 | silence_duration: 2.5\n";
  assert.deepEqual(parseSilencedetect(text), [{ start: 0, end: 2.5 }]);
});

test("chunks that split a line mid-number still report the window", () => {
  const stream = createSilencedetectStream();
  const found = [
    ...stream.push("[silencedetect @ 0x1] silence_st"),
    ...stream.push("art: 12.34\n[silencedetect @ 0x1] silence_e"),
    ...stream.push("nd: 15.5 | silence_duration: 3.16\n"),
  ];
  assert.deepEqual(found, [{ start: 12.34, end: 15.5 }]);
});

test("a stream reports each window once, as it completes", () => {
  const stream = createSilencedetectStream();
  assert.deepEqual(stream.push("silence_start: 1.0\n"), []);
  assert.deepEqual(stream.push("silence_end: 2.0\n"), [{ start: 1, end: 2 }]);
  assert.deepEqual(stream.push("silence_start: 5.0\n"), []);
  assert.deepEqual(stream.flush(), []);
});

test("a last line with no trailing newline is not lost", () => {
  const stream = createSilencedetectStream();
  stream.push("silence_start: 1.0\n");
  assert.deepEqual(stream.push("silence_end: 2.0"), []);
  assert.deepEqual(stream.flush(), [{ start: 1, end: 2 }]);
});

// ------------------------------------------------------------ json3 timing

const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "hello " }, { utf8: "there" }] },
    { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: "again" }] },
    { tStartMs: 6000, segs: [{ utf8: "\n" }] },
  ],
});

test("json3 durations survive the parse", () => {
  assert.deepEqual(parseJson3Timed(JSON3), [
    { start: 0, end: 2, text: "hello there" },
    { start: 5, end: 6, text: "again" },
  ]);
});

test("the old start-only parse is unchanged by the new one", () => {
  assert.deepEqual(parseJson3(JSON3), [
    { seconds: 0, text: "hello there" },
    { seconds: 5, text: "again" },
  ]);
});

test("dMs is accepted where dDurationMs would be", () => {
  const text = JSON.stringify({ events: [{ tStartMs: 1000, dMs: 500, segs: [{ utf8: "x" }] }] });
  assert.deepEqual(parseJson3Timed(text), [{ start: 1, end: 1.5, text: "x" }]);
});

test("an event with no duration is reported as it is, not guessed at", () => {
  const text = JSON.stringify({ events: [{ tStartMs: 1000, segs: [{ utf8: "x" }] }] });
  assert.deepEqual(parseJson3Timed(text), [{ start: 1, end: 1, text: "x" }]);
});

test("captions and their pauses, end to end", () => {
  const windows = windowsFromCues(parseJson3Timed(JSON3), 0.5);
  assert.deepEqual(windows, [{ start: 2, end: 5 }]);
  assert.deepEqual(compressibleWindows(windows, 0.5), [
    { start: 2 + LEAD_IN_SECONDS, end: 5 - LEAD_OUT_SECONDS },
  ]);
});

// ------------------------------------------------- 016: the union of two maps

test("overlapping and touching windows become one", () => {
  assert.deepEqual(
    mergeWindows([
      { start: 10, end: 14 },
      { start: 12, end: 16 },
      { start: 16.02, end: 18 },
      { start: 30, end: 31 },
    ]),
    [
      { start: 10, end: 18 },
      { start: 30, end: 31 },
    ],
  );
});

test("a window swallowed by the one before it does not shorten it", () => {
  assert.deepEqual(
    mergeWindows([
      { start: 10, end: 20 },
      { start: 12, end: 14 },
    ]),
    [{ start: 10, end: 20 }],
  );
});

test("the union takes everything either producer calls quiet", () => {
  // The musical interlude BarkernotBob wants skipped: captions say nobody speaks
  // between 30 and 60, ffmpeg hears music there and reports nothing.
  const transcript = [{ start: 30, end: 60 }];
  const ffmpeg = [{ start: 5, end: 6 }];
  assert.deepEqual(unionWindows(transcript, ffmpeg), [
    { start: 5, end: 6 },
    { start: 30, end: 60 },
  ]);
});

test("an ffmpeg map that has only reached a minute cannot erase the caption map", () => {
  // The 015 bug, as a regression test. At 4x playback the analysis trailed the
  // playhead, and every batch replaced a complete map with a shorter one.
  const transcript = map({ windows: [{ start: 600, end: 604 }] });
  const combined = combineSilence({
    transcript,
    ffmpeg: { windows: [{ start: 12, end: 13 }], analyzedTo: 60 },
    skipNonSpeech: true,
  });
  assert.deepEqual(combined.windows, [
    { start: 12, end: 13, action: "skip" },
    { start: 600, end: 604, action: "skip" },
  ]);
});

test("with non-speech skipping off, ffmpeg rules only as far as it has looked", () => {
  const transcript = map({
    windows: [
      { start: 30, end: 60 },
      { start: 600, end: 604 },
    ],
  });
  const combined = combineSilence({
    transcript,
    ffmpeg: { windows: [{ start: 12, end: 13 }], analyzedTo: 120 },
    skipNonSpeech: false,
  });
  // 30–60 is music: measured, loud, and dropped. 600–604 is past the frontier,
  // so the caption map still answers for it.
  assert.deepEqual(combined.windows, [
    { start: 12, end: 13, action: "skip" },
    { start: 600, end: 604, action: "skip" },
  ]);
});

test("a caption window straddling the frontier is cut at it, not dropped", () => {
  assert.deepEqual(spliceAtFrontier([], [{ start: 100, end: 140 }], 120), [
    { start: 120, end: 140 },
  ]);
});

test("no map at all is not a map with no windows", () => {
  assert.deepEqual(combineSilence({ skipNonSpeech: true }), { windows: [], source: null });
});

// ------------------------------------------ 017: skipping rather than speeding

test("with no ffmpeg, every caption gap is skipped", () => {
  const combined = combineSilence({
    transcript: map({ windows: [{ start: 10, end: 12 }] }),
    skipNonSpeech: true,
  });
  assert.deepEqual(combined.windows, [{ start: 10, end: 12, action: "skip" }]);
});

test("a caption gap ffmpeg has heard audio in is an instrumental, and plays fast", () => {
  // 30–60: nobody speaking, and ffmpeg measured sound there — music. 100–104:
  // both producers agree there is nothing at all.
  const combined = combineSilence({
    transcript: map({
      windows: [
        { start: 30, end: 60 },
        { start: 100, end: 104 },
      ],
    }),
    ffmpeg: { windows: [{ start: 100, end: 104 }], analyzedTo: 300 },
    skipNonSpeech: true,
  });
  assert.deepEqual(combined.windows, [
    { start: 30, end: 60, action: "speed" },
    { start: 100, end: 104, action: "skip" },
  ]);
});

test("a caption gap ffmpeg has not reached yet is skipped, not guessed at", () => {
  const combined = combineSilence({
    transcript: map({ windows: [{ start: 600, end: 604 }] }),
    ffmpeg: { windows: [{ start: 12, end: 13 }], analyzedTo: 60 },
    skipNonSpeech: true,
  });
  assert.deepEqual(combined.windows, [
    { start: 12, end: 13, action: "skip" },
    { start: 600, end: 604, action: "skip" },
  ]);
});

test("ffmpeg silence inside a caption gap splits it into a skip and two speeds", () => {
  const combined = combineSilence({
    transcript: map({ windows: [{ start: 30, end: 60 }] }),
    ffmpeg: { windows: [{ start: 40, end: 45 }], analyzedTo: 300 },
    skipNonSpeech: true,
  });
  assert.deepEqual(combined.windows, [
    { start: 30, end: 40, action: "speed" },
    { start: 40, end: 45, action: "skip" },
    { start: 45, end: 60, action: "speed" },
  ]);
});

test("subtracting takes the holes out and leaves the rest", () => {
  assert.deepEqual(
    subtractWindows([{ start: 0, end: 100 }], [
      { start: 10, end: 20 },
      { start: 90, end: 200 },
    ]),
    [
      { start: 0, end: 10 },
      { start: 20, end: 90 },
    ],
  );
});

test("a window entirely covered by a hole disappears", () => {
  assert.deepEqual(subtractWindows([{ start: 10, end: 20 }], [{ start: 0, end: 30 }]), []);
});

test("the trim keeps the action it was given", () => {
  const windows: PlaybackWindow[] = [{ start: 10, end: 20, action: "speed" }];
  assert.deepEqual(compressibleWindows(windows, 0.5), [
    { start: 10 + LEAD_IN_SECONDS, end: 20 - LEAD_OUT_SECONDS, action: "speed" },
  ]);
});

test("silence is a jump to the end of the window, not a rate", () => {
  const windows: PlaybackWindow[] = [{ start: 10, end: 14, action: "skip" }];
  assert.deepEqual(moveFor(10.2, windows, 1, 3), { kind: "skip", to: 14, rate: 1 });
});

test("an instrumental is a rate, never a jump", () => {
  const windows: PlaybackWindow[] = [{ start: 10, end: 40, action: "speed" }];
  assert.deepEqual(moveFor(20, windows, 1, 3), { kind: "rate", rate: 3 });
});

test("outside every window the base rate is handed straight back", () => {
  const windows: PlaybackWindow[] = [{ start: 10, end: 14, action: "skip" }];
  assert.deepEqual(moveFor(9, windows, 1.5, 3), { kind: "rate", rate: 1.5 });
  assert.deepEqual(moveFor(14, windows, 1.5, 3), { kind: "rate", rate: 1.5 });
});

test("too little of a window left to be worth a seek, so it plays fast instead", () => {
  const windows: PlaybackWindow[] = [{ start: 10, end: 14, action: "skip" }];
  const late = 14 - MIN_SKIP_SECONDS / 2;
  assert.deepEqual(moveFor(late, windows, 1, 3), { kind: "rate", rate: 3 });
});

test("a skip never slows anyone down, and never speeds them up either", () => {
  const windows: PlaybackWindow[] = [{ start: 10, end: 20, action: "skip" }];
  assert.deepEqual(moveFor(11, windows, 4, 3), { kind: "skip", to: 20, rate: 4 });
});

test("a skip reports the whole pause, at the speed it would have played", () => {
  assert.equal(secondsSkipped(3, 1), 3);
  assert.equal(secondsSkipped(3, 4), 0.75);
  assert.equal(secondsSkipped(0, 1), 0);
});

// --------------------------------------------------- 016: chunking the work

test("chunks start at the playhead and wrap around to the beginning", () => {
  const chunks = planChunks(300, 125, 60, 3);
  assert.deepEqual(
    chunks.map((c) => c.start),
    [120, 180, 240, 0, 60],
  );
});

test("every chunk overreaches the next, so a pause on a boundary is seen whole", () => {
  const [first] = planChunks(300, 0, 60, 3);
  assert.deepEqual(first, { start: 0, end: 63 });
});

test("the last chunk stops at the end of the video", () => {
  const chunks = planChunks(130, 0, 60, 3);
  assert.equal(chunks[chunks.length - 1].end, 130);
});

test("a video with no known duration plans no chunks", () => {
  assert.deepEqual(planChunks(0, 0, 60, 3), []);
  assert.deepEqual(planChunks(Number.NaN, 0, 60, 3), []);
});

test("a chunk's windows are shifted into whole-video time", () => {
  // silencedetect reports relative to the seek point. Measured 2026-07-29: a
  // chunk seeked to 300 s reported its first silence at 12.15.
  assert.deepEqual(offsetWindows([{ start: 12.15, end: 13.2 }], 300), [
    { start: 312.15, end: 313.2 },
  ]);
});

// ------------------------------------------------------- 016: the v2 schema

test("a v1 file migrates into the source it names, losing nothing", () => {
  const state = normalizeSilenceState({
    version: 1,
    maps: { [ID]: { source: "ffmpeg", computedAt: "2026-07-29T12:00:00.000Z", minGap: 0.5, windows: [{ start: 1, end: 2 }] } },
  });
  assert.deepEqual(state.maps[ID].sources.ffmpeg?.windows, [{ start: 1, end: 2 }]);
  assert.equal(state.maps[ID].sources.transcript, undefined);
});

test("both producers' maps live side by side for one video", () => {
  const state = emptySilenceState();
  mergeSilenceMaps(state, [map({ source: "transcript" }), map({ source: "ffmpeg" })]);
  assert.deepEqual(Object.keys(state.maps[ID].sources).sort(), ["ffmpeg", "transcript"]);
});

test("a partial map survives a round trip through the file", () => {
  const state = normalizeSilenceState(
    JSON.parse(JSON.stringify(reMerged(map({ source: "ffmpeg", analyzedTo: 240 })))),
  );
  assert.equal(state.maps[ID].sources.ffmpeg?.analyzedTo, 240);
});

function reMerged(...maps: SilenceMap[]) {
  const state = emptySilenceState();
  mergeSilenceMaps(state, maps);
  return state;
}
