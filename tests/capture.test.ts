import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyLookback,
  isInsideCodeBlock,
  lineHasTimestamp,
  shouldAutoStamp,
  stampInsertOffset,
} from "../src/capture.ts";
import type { StampGateInput } from "../src/capture.ts";

/** A watching-and-typing state where a stamp is expected. */
function gate(overrides: Partial<StampGateInput> = {}): StampGateInput {
  return {
    enabled: true,
    hasPlayer: true,
    hasPlayed: true,
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

test("auto-stamp fires once the video has been played", () => {
  assert.equal(shouldAutoStamp(gate()), true);
});

test("auto-stamp is indifferent to play/pause state", () => {
  // Regression guard. Pause-while-typing means the player is paused for most of
  // the time you are actually writing, and the user may pause by hand to think.
  // Any play-state condition here silently kills stamping in normal use, so the
  // gate must not have one — hence there is no isPlaying field to set.
  assert.equal(shouldAutoStamp(gate()), true);
  assert.equal(Object.keys(gate()).includes("isPlaying"), false);
});

test("auto-stamp does not fire for a video that was never started", () => {
  // Otherwise a note whose video is untouched stamps every line 0:00.
  assert.equal(shouldAutoStamp(gate({ hasPlayed: false })), false);
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

test("stampInsertOffset fires on the first character of an empty line", () => {
  assert.equal(stampInsertOffset("", 0), 0);
});

test("stampInsertOffset fires on the first line of a note", () => {
  // Issue: the first line never got stamped under the Enter trigger, because
  // you don't press Enter to reach it. Typing is the trigger now, so it does.
  assert.equal(stampInsertOffset("", 0), 0);
});

test("stampInsertOffset fires after indentation and list markers", () => {
  // Obsidian auto-continues lists, so the "new" line already contains "- ".
  assert.equal(stampInsertOffset("  ", 2), 2);
  assert.equal(stampInsertOffset("- ", 2), 2);
  assert.equal(stampInsertOffset("  * ", 4), 4);
  assert.equal(stampInsertOffset("1. ", 3), 3);
  assert.equal(stampInsertOffset("- [ ] ", 6), 6);
  assert.equal(stampInsertOffset("> ", 2), 2);
  assert.equal(stampInsertOffset("## ", 3), 3);
});

test("stampInsertOffset stays quiet for every later character on the line", () => {
  // The common case by far: this is what keeps one stamp per line.
  assert.equal(stampInsertOffset("already typing", 14), null);
  assert.equal(stampInsertOffset("- a", 3), null);
});

test("stampInsertOffset stays quiet when editing into existing content", () => {
  assert.equal(stampInsertOffset("existing text", 0), null);
  assert.equal(stampInsertOffset("  existing", 2), null);
  assert.equal(stampInsertOffset("existing text", 4), null);
});

test("stampInsertOffset never adds a second stamp to a line", () => {
  assert.equal(stampInsertOffset("[12:34](ytfree:abc:754) ", 24), null);
});

test("stampInsertOffset rejects an out-of-range cursor", () => {
  assert.equal(stampInsertOffset("abc", -1), null);
  assert.equal(stampInsertOffset("abc", 99), null);
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
