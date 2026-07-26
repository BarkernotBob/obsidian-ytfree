import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVideoId, parseExpiry, StreamCache } from "../src/resolver.ts";
import { formatTimestamp } from "../src/format.ts";

test("extractVideoId handles every URL shape we accept", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(extractVideoId(id), id);
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(extractVideoId(`https://youtube.com/watch?v=${id}&t=42s`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}?si=abc`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/live/${id}`), id);
  assert.equal(extractVideoId(`  https://youtu.be/${id}  \n`), id);
});

test("extractVideoId rejects non-YouTube input", () => {
  assert.equal(extractVideoId("https://vimeo.com/123456"), null);
  assert.equal(extractVideoId("just some text"), null);
  assert.equal(extractVideoId(""), null);
});

test("parseExpiry reads the query-param form used by direct video URLs", () => {
  const url = "https://rr2---sn-abc.googlevideo.com/videoplayback?expire=1785109801&ei=xyz";
  assert.equal(parseExpiry(url), 1785109801 * 1000);
});

test("parseExpiry reads the path-segment form used by HLS manifests", () => {
  // Regression: manifest URLs state expiry as a path segment, not a query
  // param. Parsing only the query form made every HLS stream look immortal.
  const url = "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1785110778/ei/abc";
  assert.equal(parseExpiry(url), 1785110778 * 1000);
});

test("parseExpiry falls back to a near-future time when no expiry is present", () => {
  const before = Date.now();
  const got = parseExpiry("https://example.com/video.mp4");
  assert.ok(got > before, "fallback expiry must be in the future");
  assert.ok(got <= before + 60 * 60 * 1000 + 1000, "fallback must stay conservative");
});

test("formatTimestamp pads correctly and switches to hours", () => {
  assert.equal(formatTimestamp(0), "0:00");
  assert.equal(formatTimestamp(9), "0:09");
  assert.equal(formatTimestamp(64), "1:04");
  assert.equal(formatTimestamp(754), "12:34");
  assert.equal(formatTimestamp(3599), "59:59");
  assert.equal(formatTimestamp(3600), "1:00:00");
  assert.equal(formatTimestamp(3754), "1:02:34");
  assert.equal(formatTimestamp(12.9), "0:12", "must floor, not round");
  assert.equal(formatTimestamp(-5), "0:00", "must clamp negatives");
});

const live = (mode: "fast" | "quality") => ({
  url: `https://x/${mode}`,
  isHls: mode === "quality",
  mode,
  expiresAt: Date.now() + 60_000,
});

test("StreamCache returns a live entry", () => {
  const cache = new StreamCache();
  const stream = live("fast");
  cache.set("abc", stream);
  assert.deepEqual(cache.get("abc", "fast"), stream);
});

test("StreamCache keeps fast and quality entries separate", () => {
  // Both modes are cached at once during a two-stage load; if they collided,
  // the background upgrade would overwrite the stream that is already playing.
  const cache = new StreamCache();
  cache.set("abc", live("fast"));
  cache.set("abc", live("quality"));
  assert.equal(cache.get("abc", "fast")?.url, "https://x/fast");
  assert.equal(cache.get("abc", "quality")?.url, "https://x/quality");
});

test("StreamCache evicts an expired entry instead of serving it", () => {
  // This is the whole point of the design: a stale URL must never reach the
  // player, because googlevideo returns 403 and playback dies.
  const cache = new StreamCache();
  cache.set("abc", { url: "https://x", isHls: true, mode: "quality", expiresAt: Date.now() - 1 });
  assert.equal(cache.get("abc", "quality"), null);
});

test("StreamCache invalidate clears both modes", () => {
  const cache = new StreamCache();
  cache.set("abc", live("fast"));
  cache.set("abc", live("quality"));
  cache.invalidate("abc");
  assert.equal(cache.get("abc", "fast"), null);
  assert.equal(cache.get("abc", "quality"), null);
});

test("StreamCache misses on an unknown id", () => {
  assert.equal(new StreamCache().get("nope", "fast"), null);
});
