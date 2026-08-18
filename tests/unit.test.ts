import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVideoId, extractVideoIds, parseExpiry, StreamCache } from "../src/stream.ts";
import { formatTimestamp } from "../src/format.ts";
import {
  buildArgs,
  downloadBaseName,
  findByVideoId,
  formatSelector,
  localFileUrl,
  parseProgress,
  sanitizeFilename,
} from "../src/desktop/download.ts";
import { ytDlpEnv } from "../src/desktop/env.ts";

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

test("ad-hoc playlist URLs yield every video, first one playable", () => {
  // The shape YouTube produces from "play all" on a suggested queue: no v=
  // param at all, commas percent-encoded, a title tacked on the end.
  const url =
    "https://www.youtube.com/watch_videos?video_ids=soYkEqDp760%2C1PGm8LslEb4%2CV-1RhQ1uuQ4" +
    "&type=0&title=Deep+Dive+-+Social+Media+Misinformation";
  assert.deepEqual(extractVideoIds(url), ["soYkEqDp760", "1PGm8LslEb4", "V-1RhQ1uuQ4"]);
  assert.equal(extractVideoId(url), "soYkEqDp760");

  // Plain commas too, since a hand-pasted URL is often already decoded.
  assert.deepEqual(
    extractVideoIds("https://www.youtube.com/watch_videos?video_ids=soYkEqDp760,1PGm8LslEb4"),
    ["soYkEqDp760", "1PGm8LslEb4"],
  );
});

test("extractVideoIds returns a single-element list for ordinary URLs", () => {
  assert.deepEqual(extractVideoIds("https://youtu.be/dQw4w9WgXcQ?si=abc"), ["dQw4w9WgXcQ"]);
  assert.deepEqual(extractVideoIds("https://vimeo.com/123456"), []);
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

// ---------------------------------------------------------------- downloads

test("sanitizeFilename removes what macOS and Obsidian both dislike", () => {
  assert.equal(sanitizeFilename("Ecclesiastes 7:1 — What/About\\Bob?"), "Ecclesiastes 7 1 — What About Bob");
  assert.equal(sanitizeFilename("  spaced   out  \n"), "spaced out");
  assert.equal(sanitizeFilename(""), "");
});

test("downloadBaseName keeps the video id even when the title is huge", () => {
  const id = "dQw4w9WgXcQ";
  const name = downloadBaseName("x".repeat(400), id);
  assert.ok(name.endsWith(`[${id}]`), "id must survive truncation — it is the identity");
  assert.ok(name.length < 160);
});

test("downloadBaseName falls back to the id alone when there is no title", () => {
  assert.equal(downloadBaseName("   ", "dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("findByVideoId survives the file being renamed", () => {
  const id = "dQw4w9WgXcQ";
  const files = ["unrelated.mp4", `Renamed By Hand [${id}].mp4`, `Other [aaaaaaaaaaa].mp4`];
  assert.equal(findByVideoId(files, id), `Renamed By Hand [${id}].mp4`);
});

test("findByVideoId never returns a partial download", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(findByVideoId([`Half Done [${id}].mp4.part`], id), null);
});

test("parseProgress reads yt-dlp progress lines and ignores everything else", () => {
  assert.deepEqual(parseProgress("[download]   1.2% of  723.45MiB at  5.00MiB/s ETA 02:24"), {
    percent: 1.2,
    totalBytes: Math.round(723.45 * 1024 ** 2),
  });
  assert.deepEqual(parseProgress("[download] 100% of 1.50GiB in 00:02:24"), {
    percent: 100,
    totalBytes: Math.round(1.5 * 1024 ** 3),
  });
  // Estimated sizes are printed with a tilde.
  assert.equal(parseProgress("[download]  50.0% of ~ 100.00MiB at 1.00MiB/s")?.percent, 50);
  assert.equal(parseProgress("[youtube] Extracting URL: https://..."), null);
  assert.equal(parseProgress("/Users/me/Movies/YT Free/Some Title [abc].mp4"), null);
  assert.equal(parseProgress(""), null);
});

test("formatSelector drops to a pre-muxed format without ffmpeg", () => {
  assert.ok(formatSelector(true).includes("+"), "with ffmpeg we merge separate streams");
  assert.ok(!formatSelector(false).includes("+"), "without ffmpeg nothing may need merging");
});

test("buildArgs downloads rather than simulating, and prints the final path", () => {
  const args = buildArgs({
    videoId: "dQw4w9WgXcQ",
    ytDlpPath: "/opt/homebrew/bin/yt-dlp",
    ffmpegPath: "/opt/homebrew/bin/ffmpeg",
    destDir: "/tmp/yt",
    baseName: "Title [dQw4w9WgXcQ]",
    onProgress: () => undefined,
  });
  // --print implies --simulate, so its absence would mean nothing downloads.
  assert.ok(args.includes("--no-simulate"));
  assert.ok(args.includes("after_move:filepath"));
  assert.ok(args.includes("--ffmpeg-location"));
  assert.ok(args.some((a) => a.includes("%(ext)s")), "extension is yt-dlp's to choose");
  assert.ok(args[args.length - 1].endsWith("dQw4w9WgXcQ"));
});

test("buildArgs omits --ffmpeg-location when ffmpeg is absent", () => {
  const args = buildArgs({
    videoId: "dQw4w9WgXcQ",
    ytDlpPath: "yt-dlp",
    ffmpegPath: null,
    destDir: "/tmp/yt",
    baseName: "x",
    onProgress: () => undefined,
  });
  assert.ok(!args.includes("--ffmpeg-location"));
});

test("localFileUrl uses Obsidian's local scheme and escapes spaces", () => {
  const url = localFileUrl("/Users/me/Movies/YT Free/Some Title [abc].mp4");
  assert.ok(url.startsWith("app://local/"));
  assert.ok(!url.includes(" "), "a raw space would break the resource URL");
});

// --------------------------------------------- the environment yt-dlp is given

test("ytDlpEnv puts the helper directories on PATH without dropping the real one", () => {
  // yt-dlp shells out to `deno` to solve YouTube's JS challenge, and Obsidian's
  // Electron process has a PATH that does not contain it. Without this, the
  // clients that need the challenge solved silently offer no formats and the
  // error reads as if the video were the problem.
  const before = process.env.PATH;
  process.env.PATH = "/somewhere/of/mine";
  try {
    const dirs = (ytDlpEnv("/opt/homebrew/bin/yt-dlp").PATH ?? "").split(":");
    assert.ok(dirs.includes("/opt/homebrew/bin"), "homebrew bin must be searchable");
    assert.ok(dirs.includes("/usr/local/bin"));
    // The user's own PATH keeps winning: appended, not prepended, not replaced.
    assert.equal(dirs[0], "/somewhere/of/mine");
  } finally {
    process.env.PATH = before;
  }
});

test("ytDlpEnv lists no directory twice and survives an empty PATH", () => {
  const before = process.env.PATH;
  process.env.PATH = "/opt/homebrew/bin";
  try {
    const dirs = (ytDlpEnv("/opt/homebrew/bin/yt-dlp").PATH ?? "").split(":");
    assert.equal(dirs.filter((d) => d === "/opt/homebrew/bin").length, 1);
    delete process.env.PATH;
    assert.ok((ytDlpEnv("").PATH ?? "").includes("/opt/homebrew/bin"));
  } finally {
    process.env.PATH = before;
  }
});
