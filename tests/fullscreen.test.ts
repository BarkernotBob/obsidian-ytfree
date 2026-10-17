import { test } from "node:test";
import assert from "node:assert/strict";
import { fullscreenPress } from "../src/fullscreen.ts";

test("a press before the stream has resolved waits", () => {
  // GitHub #9: Play, then Fullscreen while the resolve is still in flight.
  assert.equal(fullscreenPress({ inFullscreen: false, readyState: 0, resolving: true }), "wait");
});

test("a press on a player nobody has started waits", () => {
  assert.equal(fullscreenPress({ inFullscreen: false, readyState: 0, resolving: false }), "wait");
});

test("a resolve in flight wins over a stale readyState", () => {
  // A stream being swapped (the desktop's HD upgrade, a re-resolve after
  // expiry) can still report the old element's state for a moment.
  assert.equal(fullscreenPress({ inFullscreen: false, readyState: 4, resolving: true }), "wait");
});

test("a press with metadata loaded goes fullscreen", () => {
  for (const readyState of [1, 2, 3, 4]) {
    assert.equal(fullscreenPress({ inFullscreen: false, readyState, resolving: false }), "enter");
  }
});

test("the way out is never held up", () => {
  for (const resolving of [true, false]) {
    for (const readyState of [0, 4]) {
      assert.equal(fullscreenPress({ inFullscreen: true, readyState, resolving }), "exit");
    }
  }
});
