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
  assert.equal(stampInsertOffset("", 0, "a"), 0);
});

test("stampInsertOffset fires on the first line of a note", () => {
  // Issue: the first line never got stamped under the Enter trigger, because
  // you don't press Enter to reach it. Typing is the trigger now, so it does.
  assert.equal(stampInsertOffset("", 0, "T"), 0);
});

test("stampInsertOffset fires after indentation and quotes", () => {
  assert.equal(stampInsertOffset("  ", 2, "a"), 2);
  assert.equal(stampInsertOffset("> ", 2, "a"), 2);
});

test("stampInsertOffset holds its answer back on a bare hash", () => {
  // `#` opens a heading and a tag alike, so nothing is known yet. It is typed
  // clean and the character after it decides.
  assert.equal(stampInsertOffset("", 0, "#"), null);
  assert.equal(stampInsertOffset("#", 1, "#"), null);
  assert.equal(stampInsertOffset("  ", 2, "#"), null);
  assert.equal(stampInsertOffset("- ", 2, "#"), null);
});

test("stampInsertOffset never stamps a heading line", () => {
  // The space after the hashes is what makes it a heading: a label for the
  // paragraphs under it, not a thought of your own.
  assert.equal(stampInsertOffset("#", 1, " "), null);
  assert.equal(stampInsertOffset("# ", 2, "N"), null);
  assert.equal(stampInsertOffset("## ", 3, "a"), null);
  assert.equal(stampInsertOffset("###### ", 7, "a"), null);
  assert.equal(stampInsertOffset("> ## ", 5, "a"), null);
});

test("stampInsertOffset stamps a tag line in front of the hash", () => {
  // `#[3:05](…)idea` would be neither a tag nor a link, so the stamp goes
  // before the run rather than at the cursor.
  assert.equal(stampInsertOffset("#", 1, "i"), 0);
  assert.equal(stampInsertOffset("#", 1, "1"), 0);
  assert.equal(stampInsertOffset("  #", 3, "i"), 2);
  assert.equal(stampInsertOffset("- #", 3, "i"), 2);
  assert.equal(stampInsertOffset("> #", 3, "i"), 2);
});

test("stampInsertOffset leaves a tag line alone once it is under way", () => {
  // One stamp per line, and the hash rule must not reopen the question.
  assert.equal(stampInsertOffset("#idea", 5, "s"), null);
  assert.equal(stampInsertOffset("[12:34](ytfree:abc:754)#idea", 28, "s"), null);
});

test("stampInsertOffset does not fire on the bullet character itself", () => {
  // Stamping here produced "[3:05](...) -", which Obsidian never renders as a
  // list, so bulleted lists could not be started at all.
  assert.equal(stampInsertOffset("", 0, "-"), null);
  assert.equal(stampInsertOffset("", 0, "*"), null);
  assert.equal(stampInsertOffset("", 0, "+"), null);
  assert.equal(stampInsertOffset("  ", 2, "-"), null);
});

test("stampInsertOffset does not fire on whitespace", () => {
  // The space after a bullet would otherwise take the stamp, leaving
  // "- [3:05](...) " with the actual text stranded after it.
  assert.equal(stampInsertOffset("-", 1, " "), null);
  assert.equal(stampInsertOffset("", 0, " "), null);
  assert.equal(stampInsertOffset("", 0, "\t"), null);
});

test("stampInsertOffset fires on the first word after a bullet", () => {
  // The whole point of skipping the bullet and the space: the stamp arrives
  // with the text, and the list still renders.
  assert.equal(stampInsertOffset("- ", 2, "a"), 2);
  assert.equal(stampInsertOffset("* ", 2, "a"), 2);
  assert.equal(stampInsertOffset("  - ", 4, "a"), 4);
  assert.equal(stampInsertOffset("- [ ] ", 6, "a"), 6);
  assert.equal(stampInsertOffset("1. ", 3, "a"), 3);
});

test("stampInsertOffset stays quiet for every later character on the line", () => {
  // The common case by far: this is what keeps one stamp per line.
  assert.equal(stampInsertOffset("already typing", 14, "a"), null);
});

test("stampInsertOffset stays quiet when editing into existing content", () => {
  assert.equal(stampInsertOffset("existing text", 0, "a"), null);
  assert.equal(stampInsertOffset("  existing", 2, "a"), null);
  assert.equal(stampInsertOffset("existing text", 4, "a"), null);
});

test("stampInsertOffset never adds a second stamp to a line", () => {
  assert.equal(stampInsertOffset("[12:34](ytfree:abc:754) ", 24, "a"), null);
});

test("stampInsertOffset rejects an out-of-range cursor and empty input", () => {
  assert.equal(stampInsertOffset("abc", -1, "a"), null);
  assert.equal(stampInsertOffset("abc", 99, "a"), null);
  assert.equal(stampInsertOffset("", 0, ""), null);
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
