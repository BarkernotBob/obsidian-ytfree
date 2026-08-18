import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearPosition,
  emptyProgress,
  isFinished,
  MAX_PROGRESS_ENTRIES,
  MIN_REMEMBER_SECONDS,
  normalizeProgress,
  pruneProgress,
  markWatched,
  mergeProgress,
  recordPosition,
  resumePoint,
  WATCH_STAMP_INTERVAL_MS,
  watchedAt,
} from "../src/progress.ts";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const ID = "dQw4w9WgXcQ";
const OTHER = "aBcDeFgHiJk";

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

test("records a position past the floor", () => {
  const state = emptyProgress();
  assert.equal(recordPosition(state, ID, 120.7, 600, NOW), true);
  assert.deepEqual(state.positions[ID], { seconds: 120, updatedAt: NOW.toISOString() });
  assert.equal(resumePoint(state, ID), 120);
});

test("ignores the first few seconds", () => {
  const state = emptyProgress();
  assert.equal(recordPosition(state, ID, MIN_REMEMBER_SECONDS - 1, 600, NOW), false);
  assert.equal(resumePoint(state, ID), 0);
});

test("a re-report of the same second is not a change", () => {
  const state = emptyProgress();
  recordPosition(state, ID, 120, 600, NOW);
  assert.equal(recordPosition(state, ID, 120.9, 600, NOW), false);
  assert.equal(recordPosition(state, ID, 121, 600, NOW), true);
});

test("finishing clears the entry rather than parking on the credits", () => {
  const state = emptyProgress();
  recordPosition(state, ID, 120, 600, NOW);
  assert.equal(recordPosition(state, ID, 595, 600, NOW), true);
  assert.equal(ID in state.positions, false);
  assert.equal(resumePoint(state, ID), 0);
});

test("scrubbing back to the start clears it too", () => {
  const state = emptyProgress();
  recordPosition(state, ID, 300, 600, NOW);
  assert.equal(recordPosition(state, ID, 2, 600, NOW), true);
  assert.equal(resumePoint(state, ID), 0);
});

test("the end margin scales with length", () => {
  // Short clip: 3% is under a second, so the 20s floor is what applies.
  assert.equal(isFinished(69, 90), false);
  assert.equal(isFinished(70, 90), true);
  // Two-hour talk: 3% is 216s, so the last three and a half minutes count.
  assert.equal(isFinished(7000, 7200), true);
  assert.equal(isFinished(6900, 7200), false);
});

test("a stream with no known duration is never finished", () => {
  assert.equal(isFinished(500, 0), false);
  assert.equal(isFinished(500, Number.NaN), false);
  const state = emptyProgress();
  assert.equal(recordPosition(state, ID, 500, Number.NaN, NOW), true);
  assert.equal(resumePoint(state, ID), 500);
});

test("garbage positions are refused", () => {
  const state = emptyProgress();
  assert.equal(recordPosition(state, ID, Number.NaN, 600, NOW), false);
  assert.equal(recordPosition(state, ID, Number.POSITIVE_INFINITY, 600, NOW), false);
  assert.equal(recordPosition(state, "", 120, 600, NOW), false);
  assert.deepEqual(state.positions, {});
});

test("clearing reports whether there was anything to clear", () => {
  const state = emptyProgress();
  assert.equal(clearPosition(state, ID), false);
  recordPosition(state, ID, 120, 600, NOW);
  assert.equal(clearPosition(state, ID), true);
});

test("normalize drops everything it cannot trust", () => {
  const state = normalizeProgress({
    positions: {
      [ID]: { seconds: 120, updatedAt: NOW.toISOString() },
      "not-an-id": { seconds: 120, updatedAt: NOW.toISOString() },
      [OTHER]: { seconds: "nonsense", updatedAt: NOW.toISOString() },
      abcdefghijk: { seconds: 120, updatedAt: "whenever" },
      lmnopqrstuv: { seconds: 3, updatedAt: NOW.toISOString() },
    },
  });
  assert.deepEqual(Object.keys(state.positions), [ID]);
});

test("normalize survives a truncated or empty file", () => {
  assert.deepEqual(normalizeProgress(null), emptyProgress());
  assert.deepEqual(normalizeProgress({}), emptyProgress());
  assert.deepEqual(normalizeProgress({ positions: "" }), emptyProgress());
  assert.deepEqual(normalizeProgress([1, 2, 3]), emptyProgress());
});

test("prune drops what has gone stale", () => {
  const state = normalizeProgress({
    positions: {
      [ID]: { seconds: 120, updatedAt: daysAgo(400) },
      [OTHER]: { seconds: 120, updatedAt: daysAgo(10) },
    },
  });
  assert.equal(pruneProgress(state, NOW), true);
  assert.deepEqual(Object.keys(state.positions), [OTHER]);
  assert.equal(pruneProgress(state, NOW), false);
});

test("prune caps the file, oldest first", () => {
  const positions: Record<string, { seconds: number; updatedAt: string }> = {};
  for (let i = 0; i < MAX_PROGRESS_ENTRIES + 5; i++) {
    // Hours, not days: past the TTL the prune would drop them for staleness
    // instead, which is a different rule than the one under test.
    positions[`v${String(i).padStart(10, "0")}`] = { seconds: 120, updatedAt: hoursAgo(i) };
  }
  const state = normalizeProgress({ positions });
  assert.equal(pruneProgress(state, NOW), true);
  assert.equal(Object.keys(state.positions).length, MAX_PROGRESS_ENTRIES);
  // The five oldest — the largest `daysAgo` — are the ones that went.
  assert.equal("v0000000000" in state.positions, true);
  assert.equal(`v${String(MAX_PROGRESS_ENTRIES + 4).padStart(10, "0")}` in state.positions, false);
});

test("a play stamps the video as watched", () => {
  const state = emptyProgress();
  assert.equal(markWatched(state, ID, NOW), true);
  assert.equal(watchedAt(state, ID), NOW.toISOString());
  assert.equal(watchedAt(state, OTHER), null);
});

test("the watch stamp moves at most once an hour", () => {
  const state = emptyProgress();
  markWatched(state, ID, new Date(NOW.getTime() - WATCH_STAMP_INTERVAL_MS + 1000));
  assert.equal(markWatched(state, ID, NOW), false);
  assert.equal(markWatched(state, ID, new Date(NOW.getTime() + WATCH_STAMP_INTERVAL_MS)), true);
});

test("finishing a video clears the position but keeps the watch stamp", () => {
  const state = emptyProgress();
  recordPosition(state, ID, 120, 600, NOW);
  markWatched(state, ID, NOW);
  // Same call site, one report later, now at the credits.
  recordPosition(state, ID, 599, 600, NOW);
  assert.equal(resumePoint(state, ID), 0);
  assert.equal(watchedAt(state, ID), NOW.toISOString());
});

test("normalize refuses watch stamps it cannot read", () => {
  const state = normalizeProgress({
    watched: { [ID]: NOW.toISOString(), "not-an-id": NOW.toISOString(), [OTHER]: "whenever" },
  });
  assert.deepEqual(Object.keys(state.watched), [ID]);
});

test("prune drops stale watch stamps too", () => {
  const state = normalizeProgress({
    watched: { [ID]: daysAgo(400), [OTHER]: daysAgo(40) },
  });
  assert.equal(pruneProgress(state, NOW), true);
  assert.deepEqual(Object.keys(state.watched), [OTHER]);
  assert.equal(pruneProgress(state, NOW), false);
});

/*
 * The preview's contract, at the level the rules can state it: Preview calls
 * `recordPosition` and never `markWatched`, so a video you skimmed resumes
 * where you left it and still does not count as watched. `ProgressStore` has a
 * method per half for exactly this reason — see `recordPosition` there.
 */
test("a position recorded alone leaves no watch stamp", () => {
  const state = emptyProgress();
  recordPosition(state, ID, 300, 1800, NOW);
  assert.equal(resumePoint(state, ID), 300);
  assert.equal(watchedAt(state, ID), null);
});

test("a preview and a later watch are one session", () => {
  const state = emptyProgress();
  // The preview stops at five minutes...
  recordPosition(state, ID, 300, 1800, NOW);
  // ...and the note opens against the same key, not a note path.
  assert.equal(resumePoint(state, ID), 300);
  // Watching from there stamps it; previewing never did.
  assert.equal(markWatched(state, ID, NOW), true);
  assert.equal(watchedAt(state, ID), NOW.toISOString());
});

test("a merge keeps the newer position for each video, whichever side it is on", () => {
  // 3: the phone writes at 12:05, the desktop's copy in memory is from 11:00.
  // Blind-writing the desktop's copy is what lost the phone's afternoon.
  const mine = emptyProgress();
  mine.positions[ID] = { seconds: 30, updatedAt: "2026-07-29T11:00:00.000Z" };
  mine.positions[OTHER] = { seconds: 900, updatedAt: "2026-07-29T12:30:00.000Z" };

  const theirs = emptyProgress();
  theirs.positions[ID] = { seconds: 600, updatedAt: "2026-07-29T12:05:00.000Z" };
  theirs.positions[OTHER] = { seconds: 10, updatedAt: "2026-07-29T09:00:00.000Z" };

  const merged = mergeProgress(mine, theirs);
  assert.equal(merged.positions[ID].seconds, 600);
  assert.equal(merged.positions[OTHER].seconds, 900);
});

test("a merge is the union, not an overwrite", () => {
  const mine = emptyProgress();
  mine.positions[ID] = { seconds: 30, updatedAt: "2026-07-29T11:00:00.000Z" };
  const theirs = emptyProgress();
  theirs.positions[OTHER] = { seconds: 40, updatedAt: "2026-07-29T11:00:00.000Z" };

  const merged = mergeProgress(mine, theirs);
  assert.deepEqual(Object.keys(merged.positions).sort(), [ID, OTHER].sort());
});

test("watch stamps merge on the same rule as positions", () => {
  const mine = emptyProgress();
  mine.watched[ID] = "2026-07-29T11:00:00.000Z";
  const theirs = emptyProgress();
  theirs.watched[ID] = "2026-07-29T12:00:00.000Z";
  theirs.watched[OTHER] = "2026-07-20T12:00:00.000Z";

  const merged = mergeProgress(mine, theirs);
  assert.equal(merged.watched[ID], "2026-07-29T12:00:00.000Z");
  assert.equal(merged.watched[OTHER], "2026-07-20T12:00:00.000Z");
});

test("an unreadable stamp loses to a readable one, from either side", () => {
  // A half-written file from the other device must not be able to roll a real
  // position back just by having a stamp that does not parse.
  const mine = emptyProgress();
  mine.positions[ID] = { seconds: 300, updatedAt: "2026-07-29T11:00:00.000Z" };
  const theirs = emptyProgress();
  theirs.positions[ID] = { seconds: 0, updatedAt: "not a date" };
  assert.equal(mergeProgress(mine, theirs).positions[ID].seconds, 300);
  assert.equal(mergeProgress(theirs, mine).positions[ID].seconds, 300);
});

test("neither side is mutated by a merge", () => {
  const mine = emptyProgress();
  mine.positions[ID] = { seconds: 30, updatedAt: "2026-07-29T11:00:00.000Z" };
  const theirs = emptyProgress();
  theirs.positions[OTHER] = { seconds: 40, updatedAt: "2026-07-29T11:00:00.000Z" };

  mergeProgress(mine, theirs);
  assert.deepEqual(Object.keys(mine.positions), [ID]);
  assert.deepEqual(Object.keys(theirs.positions), [OTHER]);
});
