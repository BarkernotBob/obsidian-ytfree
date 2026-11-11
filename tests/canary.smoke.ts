/**
 * The canary — hits YouTube for real, as little as it can (GitHub #39).
 *
 * The project's biggest risk is YouTube changing something so yt-dlp stops
 * handing out streams that play. This proves the one path every desktop open
 * takes still works: one yt-dlp resolve and one read of the bytes. About 5
 * requests, the plugin's own identity, one video.
 *
 *   npm run smoke            (once per 24 h per machine)
 *   npm run smoke -- --force
 *
 * Run through `scripts/smoke.mjs`, which keeps the daily limit and prints the
 * request count. The old full suite is parked in `tests/live/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findYtDlp, resolveStream } from "../src/desktop/resolver.ts";
import { parseExpiry } from "../src/stream.ts";

/** Stable, long-lived, not age-restricted. */
const VIDEO_ID = "dQw4w9WgXcQ";

test("yt-dlp resolves a stream that serves video bytes", async () => {
  // findYtDlp only runs `--version`: no request.
  const ytDlp = await findYtDlp("");
  // One `yt-dlp -J`, as the plugin makes on every desktop open (GitHub #32).
  const stream = await resolveStream(VIDEO_ID, ytDlp, "fast");
  assert.ok(stream.url.includes("videoplayback"), "expected a direct videoplayback URL");
  assert.match(stream.url, /[?&]expire=\d+|\/expire\/\d+/, "no expire field: googlevideo changed its URL shape");
  assert.ok(parseExpiry(stream.url) > Date.now(), "expiry must parse to a future time");

  // The end-to-end proof: on 2026-08-17 resolution looked healthy while every
  // URL answered 403 to the first byte.
  const res = await fetch(stream.url, { headers: { Range: "bytes=0-65535" } });
  assert.equal(res.status, 206, "expected HTTP 206 Partial Content");
  assert.match(res.headers.get("content-type") ?? "", /^video\//);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.length > 1000, `got only ${bytes.length} bytes`);
});
