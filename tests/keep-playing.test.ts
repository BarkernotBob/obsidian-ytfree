import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldResumeSystemPause, SYSTEM_PAUSE_WINDOW_MS } from "../src/keep-playing.ts";

const base = { pauseAt: 10_000, readerPauseAt: 0, pausedByTyping: false, causeAt: 10_000, ended: false };

test("a pause right at leaving fullscreen, locking or switching away is resumed", () => {
  assert.equal(shouldResumeSystemPause(base), true);
});

test("the pause may land either side of its cause", () => {
  assert.equal(shouldResumeSystemPause({ ...base, causeAt: 10_000 - 300 }), true);
  assert.equal(shouldResumeSystemPause({ ...base, causeAt: 10_000 + 300 }), true);
});

test("a pause long before or after the cause is someone else's", () => {
  const far = SYSTEM_PAUSE_WINDOW_MS + 1;
  assert.equal(shouldResumeSystemPause({ ...base, causeAt: 10_000 - far }), false);
  assert.equal(shouldResumeSystemPause({ ...base, causeAt: 10_000 + far }), false);
});

test("a pause the reader asked for is never resumed", () => {
  assert.equal(shouldResumeSystemPause({ ...base, readerPauseAt: 10_000 - 5 }), false);
});

test("an old reader pause does not shield a new system pause", () => {
  assert.equal(shouldResumeSystemPause({ ...base, readerPauseAt: 2_000 }), true);
});

test("a typing pause belongs to its own idle timer", () => {
  assert.equal(shouldResumeSystemPause({ ...base, pausedByTyping: true }), false);
});

test("the end of the video is not a pause to undo", () => {
  assert.equal(shouldResumeSystemPause({ ...base, ended: true }), false);
});

test("no cause yet, or no pause, means nothing to do", () => {
  assert.equal(shouldResumeSystemPause({ ...base, causeAt: 0 }), false);
  assert.equal(shouldResumeSystemPause({ ...base, pauseAt: 0 }), false);
});
