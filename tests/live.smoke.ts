/**
 * Live smoke test — hits YouTube for real.
 *
 * This is the canary for the project's biggest risk: YouTube changing
 * extraction so yt-dlp stops resolving streams. Unit tests cannot catch that.
 * Run before shipping any change, and whenever playback starts failing.
 *
 *   npm run smoke
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findYtDlp, resolveStream, parseExpiry } from "../src/resolver.ts";

// Stable, long-lived, non-age-restricted video.
const VIDEO_ID = "dQw4w9WgXcQ";

test("yt-dlp is installed and findable without a shell PATH", async () => {
  const path = await findYtDlp("");
  assert.ok(path.endsWith("yt-dlp"), `unexpected path: ${path}`);
});

test("HLS resolution returns a manifest with a real expiry", async () => {
  const ytDlp = await findYtDlp("");
  const stream = await resolveStream(VIDEO_ID, ytDlp, "quality");

  assert.ok(stream.url.startsWith("https://"), "must be an https URL");
  assert.equal(stream.isHls, true, "preferHls should yield an HLS manifest");
  assert.ok(
    parseExpiry(stream.url) > Date.now(),
    "expiry must parse to a future time — if this fails, googlevideo changed its URL shape",
  );
});

test("progressive MP4 resolution works as the fallback path", async () => {
  const ytDlp = await findYtDlp("");
  const stream = await resolveStream(VIDEO_ID, ytDlp, "fast");
  assert.ok(stream.url.includes("videoplayback"), "expected a direct videoplayback URL");
  assert.equal(stream.isHls, false);
});

test("the resolved stream actually serves video bytes", async () => {
  // The end-to-end proof: no YouTube player involved, real media on the wire.
  const ytDlp = await findYtDlp("");
  const stream = await resolveStream(VIDEO_ID, ytDlp, "fast");

  const res = await fetch(stream.url, { headers: { Range: "bytes=0-65535" } });
  assert.equal(res.status, 206, "expected HTTP 206 Partial Content");
  assert.match(res.headers.get("content-type") ?? "", /^video\//);

  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.length > 1000, `got only ${bytes.length} bytes`);
});

test("an invalid video id fails loudly rather than silently", async () => {
  const ytDlp = await findYtDlp("");
  await assert.rejects(
    () => resolveStream("aaaaaaaaaaa", ytDlp, "fast"),
    /./,
    "a bad id must throw so the UI can show an actionable error",
  );
});
