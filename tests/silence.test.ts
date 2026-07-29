import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compressibleWindows,
  createSilencedetectStream,
  emptySilenceState,
  isBetterMap,
  isStale,
  LEAD_IN_SECONDS,
  LEAD_OUT_SECONDS,
  mergeSilenceMaps,
  normalizeSilenceState,
  parseSilencedetect,
  pruneSilenceMaps,
  rateFor,
  secondsSaved,
  windowsFromCues,
} from "../src/silence.ts";
import type { SilenceMap } from "../src/silence.ts";
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

test("ffmpeg beats transcript regardless of age", () => {
  const older = map({ source: "ffmpeg", computedAt: "2020-01-01T00:00:00.000Z" });
  const newer = map({ source: "transcript", computedAt: "2026-07-29T12:00:00.000Z" });
  assert.equal(isBetterMap(older, newer), true);
  assert.equal(isBetterMap(newer, older), false);
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
    state.maps[`v${i}`] = map({
      videoId: `v${i}`,
      computedAt: `2026-07-0${i + 1}T00:00:00.000Z`,
    });
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
  assert.deepEqual(state.maps[ID].windows, [
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
