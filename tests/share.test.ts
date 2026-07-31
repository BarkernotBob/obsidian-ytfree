import { test } from "node:test";
import assert from "node:assert/strict";
import { shareUrl } from "../src/share.ts";
import { applyLookback } from "../src/capture.ts";

test("shareUrl is the short form", () => {
  assert.equal(shareUrl("dQw4w9WgXcQ"), "https://youtu.be/dQw4w9WgXcQ");
});

test("shareUrl carries a timestamp in whole seconds", () => {
  assert.equal(shareUrl("dQw4w9WgXcQ", 754), "https://youtu.be/dQw4w9WgXcQ?t=754");
  assert.equal(shareUrl("dQw4w9WgXcQ", 754.9), "https://youtu.be/dQw4w9WgXcQ?t=754");
});

test("shareUrl never writes a timestamp of zero", () => {
  assert.equal(shareUrl("dQw4w9WgXcQ", 0), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(shareUrl("dQw4w9WgXcQ", 0.4), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(shareUrl("dQw4w9WgXcQ", -5), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(shareUrl("dQw4w9WgXcQ", null), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(shareUrl("dQw4w9WgXcQ", Number.NaN), "https://youtu.be/dQw4w9WgXcQ");
});

test("shareUrl trims the id", () => {
  assert.equal(shareUrl("  dQw4w9WgXcQ\n"), "https://youtu.be/dQw4w9WgXcQ");
});

/*
 * The lookback belongs to the *caller* — `shareVideo` never sees a raw
 * playhead — but the pair is the behaviour BarkernotBob asked for, so the pair is
 * what is pinned: a link shared at 12:34 with a 5-second lookback starts at
 * 12:29, the same shift a typed timestamp gets.
 */
test("a shared moment carries the same lookback a note timestamp does", () => {
  assert.equal(
    shareUrl("dQw4w9WgXcQ", applyLookback(754, 5)),
    "https://youtu.be/dQw4w9WgXcQ?t=749",
  );
  // Inside the lookback of the start, the shift floors at 0 and the timestamp
  // drops out entirely rather than becoming a link to "the beginning".
  assert.equal(shareUrl("dQw4w9WgXcQ", applyLookback(3, 5)), "https://youtu.be/dQw4w9WgXcQ");
});
