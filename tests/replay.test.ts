/**
 * Replay tests (GitHub #38): the paths that used to need YouTube, run against
 * recorded fixtures with no network. Every folder under
 * `tests/fixtures/replay/` is replayed; `node tools/record-fixtures.ts
 * <videoId>` adds one from a real video. `synthetic` is recorded from files
 * `tools/make-offline-hd.mjs` made, so these tests run before anyone records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHdFromYtDlp, rungUrl, withRange } from "../src/adaptive.ts";
import { trimPlayerAnswer } from "../src/answer-trim.ts";
import { BotCheckBreaker, isBotCheckPlayability } from "../src/bot-check.ts";
import { pickMuxedFormat } from "../src/mobile/player-response.ts";
import type { PlayerResponse } from "../src/mobile/player-response.ts";
import { offlineFile, offlineFormats, offlineUrl, parseOfflineManifest } from "../src/offline-hd.ts";
import { offlineFetchRange } from "../src/desktop/offline-hd.ts";
import { parseJson3, pickCaptionTrack, pickPlayerCaptionTrack, topPeaks } from "../src/transcript.ts";
import type { CaptionedPlayerResponse } from "../src/transcript.ts";
import { fastStreamFromInfo, infoExpiresAt, pickAudioUrl } from "../src/ytdlp-info.ts";
import type { YtDlpInfo } from "../src/ytdlp-info.ts";
import { FIXTURE_HOST, replayFetch, rewriteUrl, rewriteUrls } from "../tools/fixture-format.ts";

const ROOT = new URL("./fixtures/replay/", import.meta.url).pathname;
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

interface Fixture {
  name: string;
  info: YtDlpInfo;
  bytes: Record<string, Uint8Array>;
  captions: string | null;
  player: unknown;
}

function load(name: string): Fixture {
  const dir = join(ROOT, name);
  const bytes: Record<string, Uint8Array> = {};
  for (const file of readdirSync(join(dir, "bytes"))) {
    bytes[file.replace(/\.bin$/, "")] = new Uint8Array(readFileSync(join(dir, "bytes", file)));
  }
  const captionsPath = join(dir, "captions", "en.json3");
  const playerPath = join(dir, "player-android.json");
  return {
    name,
    info: JSON.parse(readFileSync(join(dir, "ytdlp.json"), "utf8")) as YtDlpInfo,
    bytes,
    captions: existsSync(captionsPath) ? readFileSync(captionsPath, "utf8") : null,
    player: existsSync(playerPath) ? JSON.parse(readFileSync(playerPath, "utf8")) : null,
  };
}

const fixtures = readdirSync(ROOT).map(load);

test("there is at least one replay fixture", () => {
  assert.ok(fixtures.length >= 1);
});

for (const fx of fixtures) {
  test(`${fx.name}: no real server is named anywhere in the fixture`, () => {
    const text = readFileSync(join(ROOT, fx.name, "ytdlp.json"), "utf8") +
      (fx.player ? JSON.stringify(fx.player) : "");
    assert.equal(/googlevideo\.com|offline-hd\.invalid/.test(text), false);
  });

  test(`${fx.name}: 360p is the single file from the one answer`, () => {
    const stream = fastStreamFromInfo(fx.info);
    assert.ok(stream.url.startsWith(`${FIXTURE_HOST}v/`));
    assert.equal(stream.isHls, false);
    assert.ok(infoExpiresAt(fx.info, 0) > Date.parse("2099-01-01"));
    assert.ok(pickAudioUrl(fx.info.formats ?? [])?.startsWith(FIXTURE_HOST));
  });

  test(`${fx.name}: HD stitches from the recorded openings in 2 reads (GitHub #66 ceiling)`, async () => {
    const fetch = replayFetch(fx.bytes);
    const stream = await resolveHdFromYtDlp(fx.name, fx.info.formats ?? [], fetch);
    assert.equal(stream.isHls, true);
    assert.ok((stream.height ?? 0) >= 720, `top rung ${stream.height}p`);
    assert.ok(fetch.reads.length <= 2, `${fetch.reads.length} reads`);

    const top = stream.virtual!.files[rungUrl(fx.name, stream.height!)];
    const segments = top.split("\n").filter((l) => l.startsWith("#EXTINF:"));
    assert.ok(segments.length > 1, "the top rung has segments");

    // A lower rung is read only when hls.js first asks for it.
    const lazy = Object.entries(stream.virtual!.lazyFiles ?? {});
    if (lazy.length) {
      const before = fetch.reads.length;
      const playlist = await lazy[0][1]();
      assert.match(playlist, /#EXTINF:/);
      assert.ok(fetch.reads.length > before, "the lower rung was read on demand");
    }
  });

  test(`${fx.name}: the transcript comes from the same answer`, () => {
    const track = pickCaptionTrack(fx.info, "en");
    if (!fx.captions) return assert.equal(track, null);
    assert.ok(track?.url.startsWith(`${FIXTURE_HOST}timedtext/`));
    assert.ok(parseJson3(fx.captions).length > 0);
  });

  test(`${fx.name}: the heatmap's peaks read from the same answer`, () => {
    if (!fx.info.heatmap?.length) return;
    assert.ok(topPeaks(fx.info.heatmap, 3).length > 0);
  });

  if (fx.player) {
    test(`${fx.name}: the phone's 360p and captions read the recorded player answer`, () => {
      assert.ok(pickMuxedFormat(fx.player as PlayerResponse));
    });
  }
}

// The player answers recorded earlier (tests/fixtures/), replayed through the
// trim the device store applies: what is stored must still play (GitHub #34).
test("a trimmed player answer still gives the phone its 360p and captions", () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES, "player-android-ok.json"), "utf8"));
  const trimmed = trimPlayerAnswer(raw);
  assert.equal(pickMuxedFormat(trimmed as PlayerResponse), pickMuxedFormat(raw as PlayerResponse));
  assert.deepEqual(
    pickPlayerCaptionTrack(trimmed as CaptionedPlayerResponse, "en"),
    pickPlayerCaptionTrack(raw as CaptionedPlayerResponse, "en"),
  );
});

test("the breaker trips on the recorded bot check and not on the recorded age gate", () => {
  const breaker = new BotCheckBreaker(() => 1000);
  for (const file of ["player-login-required.json", "player-android-ok.json", "player-unavailable.json"]) {
    const s = JSON.parse(readFileSync(join(FIXTURES, file), "utf8")).playabilityStatus ?? {};
    if (isBotCheckPlayability(s.status, s.reason)) breaker.trip();
  }
  assert.equal(breaker.isPaused(), false);
  const bot = JSON.parse(readFileSync(join(FIXTURES, "player-bot-check.json"), "utf8")).playabilityStatus;
  if (isBotCheckPlayability(bot.status, bot.reason)) breaker.trip();
  assert.equal(breaker.isPaused(), true);
});

// ------------------------------------------------------------ fixture format

test("googlevideo and caption URLs are rewritten; other URLs are left alone", () => {
  assert.equal(
    rewriteUrl("https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&itag=137&ip=1.2.3.4"),
    `${FIXTURE_HOST}v/137?expire=4102444800`,
  );
  assert.equal(
    rewriteUrl("https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=json3&signature=s"),
    `${FIXTURE_HOST}timedtext/en.json3`,
  );
  assert.equal(rewriteUrl("https://i.ytimg.com/vi/x/hq.jpg"), "https://i.ytimg.com/vi/x/hq.jpg");
  assert.deepEqual(rewriteUrls({ a: ["https://x.googlevideo.com/v?itag=18"], n: 3 }), {
    a: [`${FIXTURE_HOST}v/18?expire=4102444800`],
    n: 3,
  });
});

// -------------------------------------------------------- offline HD player

test("an offline manifest becomes yt-dlp-shaped formats, and its URLs stay in the folder", () => {
  const m = parseOfflineManifest(JSON.stringify({
    progressive: "360.mp4",
    videos: [{ file: "video-720.mp4", width: 1280, height: 720, codecs: "avc1.4d401f", kbps: 2500 }],
    audio: { file: "audio.m4a", codecs: "mp4a.40.2", kbps: 128 },
  }))!;
  const formats = offlineFormats(m);
  assert.equal(formats.length, 2);
  assert.equal(offlineFile(formats[0].url!), "video-720.mp4");
  assert.equal(offlineFile(withRange(formats[0].url!, 0, 10)), "video-720.mp4");
  assert.equal(offlineFile(offlineUrl("../secret")), null);
  assert.equal(offlineFile("https://example.com/video-720.mp4"), null);
  assert.equal(parseOfflineManifest("{}"), null);
  assert.equal(parseOfflineManifest("not json"), null);
});

test("the offline player stitches HD from files on disk", async () => {
  // The synthetic fixture's openings, padded out to a 100 s video's length
  // (sparse, so nothing is written): the files the offline player reads.
  const fx = fixtures.find((f) => f.name === "synthetic")!;
  const dir = mkdtempSync(join(tmpdir(), "ytfree-offline-"));
  const videos = (fx.info.formats ?? []).filter((f) => f.height && f.acodec === "none");
  const audio = (fx.info.formats ?? []).find((f) => f.vcodec === "none")!;
  const files = [...videos, audio].map((f) => {
    const file = `${f.format_id}.mp4`;
    writeFileSync(join(dir, file), fx.bytes[f.format_id!]);
    truncateSync(join(dir, file), 64 << 20);
    return file;
  });
  writeFileSync(join(dir, "offline.json"), JSON.stringify({
    progressive: "360.mp4",
    videos: videos.map((f, i) => ({ file: files[i], width: f.width, height: f.height, codecs: f.vcodec, kbps: f.tbr })),
    audio: { file: files[files.length - 1], codecs: audio.acodec, kbps: audio.tbr },
  }));
  const manifest = parseOfflineManifest(readFileSync(join(dir, "offline.json"), "utf8"))!;
  try {
    const stream = await resolveHdFromYtDlp("offline", offlineFormats(manifest), offlineFetchRange(dir));
    assert.equal(stream.height, 1080);
    assert.ok(stream.virtual!.files[rungUrl("offline", 1080)].includes("#EXTINF:"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
