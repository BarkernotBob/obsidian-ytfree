import { test } from "node:test";
import assert from "node:assert/strict";
import { shareUrl } from "../src/share.ts";

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
