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
  recordPosition,
  resumePoint,
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
