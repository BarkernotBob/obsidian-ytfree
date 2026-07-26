import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyLookback,
  isInsideCodeBlock,
  lineHasTimestamp,
  shouldAutoStamp,
} from "../src/capture.ts";
import type { StampGateInput } from "../src/capture.ts";

/** A watching-and-typing state where a stamp is expected. */
function gate(overrides: Partial<StampGateInput> = {}): StampGateInput {
  return {
    enabled: true,
    hasPlayer: true,
    isPlaying: true,
    pausedByTyping: false,
    lineText: "",
    insideCodeBlock: false,
    ...overrides,
  };
}

test("applyLookback shifts the captured position back", () => {
  assert.equal(applyLookback(100, 5), 95);
  assert.equal(applyLookback(100.9, 5), 95);
});

test("applyLookback clamps at zero near the start of a video", () => {
  // A negative seek target would be written into the note as a broken link.
  assert.equal(applyLookback(3, 5), 0);
  assert.equal(applyLookback(0, 5), 0);
});

test("applyLookback tolerates junk input", () => {
  assert.equal(applyLookback(100, -5), 100);
  assert.equal(applyLookback(NaN, 5), 0);
  assert.equal(applyLookback(100, NaN), 100);
});

test("applyLookback of zero is the raw position", () => {
  assert.equal(applyLookback(42, 0), 42);
});

test("auto-stamp fires while the video is playing", () => {
  assert.equal(shouldAutoStamp(gate()), true);
});

test("auto-stamp still fires when we paused the video for typing", () => {
  // Regression guard for the interaction that makes this feature fail in its
  // own default configuration: pause-while-typing is on, so by the time Enter
  // arrives the player is paused. Gating on isPlaying alone kills auto-stamp
  // entirely.
  assert.equal(shouldAutoStamp(gate({ isPlaying: false, pausedByTyping: true })), true);
});

test("auto-stamp does not fire for a video the user paused", () => {
  assert.equal(shouldAutoStamp(gate({ isPlaying: false, pausedByTyping: false })), false);
});

test("auto-stamp does not fire with no player in the note", () => {
  assert.equal(shouldAutoStamp(gate({ hasPlayer: false })), false);
});

test("auto-stamp respects its off switch", () => {
  assert.equal(shouldAutoStamp(gate({ enabled: false })), false);
});

test("auto-stamp does not fire inside a code block", () => {
  assert.equal(shouldAutoStamp(gate({ insideCodeBlock: true })), false);
});

test("auto-stamp does not add a second stamp to a stamped line", () => {
  assert.equal(shouldAutoStamp(gate({ lineText: "[12:34](ytfree:abc:754) note" })), false);
});

test("lineHasTimestamp only matches our own scheme", () => {
  assert.equal(lineHasTimestamp("[12:34](ytfree:abc:754)"), true);
  assert.equal(lineHasTimestamp("plain text with a [link](https://x)"), false);
  assert.equal(lineHasTimestamp(""), false);
});

test("isInsideCodeBlock finds a cursor inside a ytfree block", () => {
  const lines = ["notes", "```ytfree", "dQw4w9WgXcQ", "```", "more"];
  assert.equal(isInsideCodeBlock(lines, 2), true);
});

test("isInsideCodeBlock treats the opening fence line as inside", () => {
  // Pressing Enter on the fence line puts the new line in the block.
  const lines = ["notes", "```ytfree", "dQw4w9WgXcQ", "```", "more"];
  assert.equal(isInsideCodeBlock(lines, 1), true);
});

test("isInsideCodeBlock is false outside the fences", () => {
  const lines = ["notes", "```ytfree", "dQw4w9WgXcQ", "```", "more"];
  assert.equal(isInsideCodeBlock(lines, 0), false);
  assert.equal(isInsideCodeBlock(lines, 3), false);
  assert.equal(isInsideCodeBlock(lines, 4), false);
});

test("isInsideCodeBlock covers non-ytfree and tilde fences too", () => {
  assert.equal(isInsideCodeBlock(["```js", "x = 1", "```"], 1), true);
  assert.equal(isInsideCodeBlock(["~~~", "x", "~~~"], 1), true);
});

test("isInsideCodeBlock handles an unterminated fence", () => {
  assert.equal(isInsideCodeBlock(["```ytfree", "dQw4w9WgXcQ"], 1), true);
});

test("isInsideCodeBlock survives an out-of-range line index", () => {
  assert.equal(isInsideCodeBlock([], 5), false);
  assert.equal(isInsideCodeBlock(["plain"], 99), false);
});
