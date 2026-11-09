/**
 * One answer per video (GitHub #32, #33): the cache that shares it, and what
 * the desktop takes out of one `yt-dlp -J`.
 *
 * The `-J` here is hand-written in yt-dlp's shape (format ids, protocols and
 * codecs as yt-dlp reports them); Part 4 (#38) replaces it with a recorded one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InfoCache } from "../src/info-cache.ts";
import {
  fastStreamFromInfo,
  hlsStreamFromInfo,
  infoExpiresAt,
  pickAudioUrl,
  pickHls,
  pickProgressive,
} from "../src/ytdlp-info.ts";
import type { YtDlpInfo } from "../src/ytdlp-info.ts";
import { EXPIRY_SAFETY_MARGIN_MS } from "../src/stream.ts";

const EXPIRE = 1_900_000_000;
const gv = (itag: string, expire = EXPIRE) => `https://rr5.googlevideo.com/videoplayback?itag=${itag}&expire=${expire}`;
const info: YtDlpInfo = {
  duration: 212,
  formats: [
    { format_id: "sb0", url: "https://i.ytimg.com/sb/x/storyboard3_L0/default.jpg", protocol: "mhtml", ext: "mhtml", vcodec: "none", acodec: "none" },
    { format_id: "249", url: gv("249"), protocol: "https", ext: "webm", vcodec: "none", acodec: "opus", tbr: 50 },
    { format_id: "140", url: gv("140", EXPIRE - 60), protocol: "https", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", tbr: 129 },
    { format_id: "18", url: gv("18"), protocol: "https", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height: 360 },
    { format_id: "137", url: gv("137"), protocol: "https", ext: "mp4", vcodec: "avc1.640028", acodec: "none", height: 1080 },
    { format_id: "96", url: "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1900000000/itag/96/index.m3u8", protocol: "m3u8_native", ext: "mp4", vcodec: "avc1.640028", acodec: "mp4a.40.2", height: 1080 },
    { format_id: "95", url: "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1900000000/itag/95/index.m3u8", protocol: "m3u8_native", ext: "mp4", vcodec: "avc1.4d401f", acodec: "mp4a.40.2", height: 720 },
  ],
};

test("360p is itag 18 from the -J, a single file", () => {
  assert.equal(pickProgressive(info.formats!)?.format_id, "18");
  const stream = fastStreamFromInfo(info);
  assert.equal(stream.url, gv("18"));
  assert.equal(stream.isHls, false);
  assert.equal(stream.mode, "fast");
  assert.equal(stream.expiresAt, EXPIRE * 1000 - EXPIRY_SAFETY_MARGIN_MS);
});

test("with no single file, the first frame comes from an HLS variant; with neither, it throws", () => {
  const hlsOnly = { formats: info.formats!.filter((f) => f.format_id !== "18") };
  const stream = fastStreamFromInfo(hlsOnly);
  assert.equal(stream.isHls, true);
  assert.match(stream.url, /itag\/96/);
  assert.throws(() => fastStreamFromInfo({ formats: [] }), /no format a player can open/);
});

test("HD's last resort is the tallest HLS variant at or under the cap", () => {
  assert.equal(pickHls(info.formats!, 1080)?.format_id, "96");
  assert.equal(pickHls(info.formats!, 720)?.format_id, "95");
  assert.equal(hlsStreamFromInfo(info)?.mode, "quality");
  assert.equal(hlsStreamFromInfo({ formats: [] }), null);
});

test("Smart Speed's audio is the M4A sound alone, from the same answer", () => {
  assert.equal(pickAudioUrl(info.formats!), gv("140", EXPIRE - 60));
  assert.equal(pickAudioUrl([]), null);
});

test("the answer is kept until the first of its playable links expires", () => {
  assert.equal(infoExpiresAt(info), (EXPIRE - 60) * 1000 - EXPIRY_SAFETY_MARGIN_MS);
  assert.equal(infoExpiresAt({ formats: [] }, 123), 123, "nothing playable: not kept");
});

test("InfoCache: concurrent asks share one request, and the answer is kept", async () => {
  let now = 1000;
  const cache = new InfoCache<string>(() => now);
  let loads = 0;
  const load = async () => (loads++, "answer");
  const [a, b] = await Promise.all([cache.get("v", load, () => 5000), cache.get("v", load, () => 5000)]);
  assert.equal(a, "answer");
  assert.equal(b, "answer");
  assert.equal(await cache.get("v", load, () => 5000), "answer");
  assert.equal(loads, 1);
  now = 5000;
  await cache.get("v", load, () => 9000);
  assert.equal(loads, 2, "expired: asked again");
});

test("InfoCache: a failure is not kept, invalidate forgets, and size is bounded", async () => {
  const cache = new InfoCache<string>(() => 0, 2);
  let fail = true;
  let loads = 0;
  const load = async () => {
    loads++;
    if (fail) throw new Error("nope");
    return "ok";
  };
  await assert.rejects(cache.get("v", load, () => 10), /nope/);
  fail = false;
  assert.equal(await cache.get("v", load, () => 10), "ok");
  cache.invalidate("v");
  await cache.get("v", load, () => 10);
  assert.equal(loads, 3);

  await cache.get("w", load, () => 10);
  await cache.get("x", load, () => 10); // pushes out "v", the oldest
  await cache.get("v", load, () => 10);
  assert.equal(loads, 6);
});

test("InfoCache: an answer marked not worth keeping is asked for again", async () => {
  const cache = new InfoCache<string>(() => 100);
  let loads = 0;
  await cache.get("v", async () => (loads++, "x"), () => 100);
  await cache.get("v", async () => (loads++, "x"), () => 100);
  assert.equal(loads, 2);
});

test("InfoCache: peek hands over a kept or in-flight answer and never loads (GitHub #66 G1)", async () => {
  let now = 1000;
  const cache = new InfoCache<string>(() => now);
  assert.equal(cache.peek("v"), null);
  let release!: (v: string) => void;
  const pending = cache.get("v", () => new Promise<string>((r) => (release = r)), () => 5000);
  const shared = cache.peek("v");
  assert.ok(shared, "an answer on its way is shared");
  release("answer");
  assert.equal(await shared, "answer");
  assert.equal(await pending, "answer");
  assert.equal(await cache.peek("v"), "answer");
  now = 5000;
  assert.equal(cache.peek("v"), null, "an expired answer is not handed over");
});
