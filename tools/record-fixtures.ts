/**
 * Record one video as a replay fixture (GitHub #38).
 *
 *   node tools/record-fixtures.ts <videoId> [--name <dir>]     from YouTube
 *   node tools/record-fixtures.ts --offline <folder> --name <dir>   from disk
 *
 * From YouTube it is human-run and guarded like the smoke canary: once a day
 * per machine (`--force` overrides), and it prints what it sent. One video
 * costs 1 yt-dlp run, 1 ANDROID player call, 1 caption file and one read of
 * each HD file's opening (about 7): roughly 10 requests, once, after which
 * `npm test` replays them forever with none.
 *
 * `--offline` records a folder made by `tools/make-offline-hd.mjs` instead,
 * with no network at all; that is how `tests/fixtures/replay/synthetic` was
 * made.
 *
 * The layout and the URL rewriting are in `tools/fixture-format.ts`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { locateIndex, withRange, ytDlpCandidates } from "../src/adaptive.ts";
import type { FetchRange, YtDlpFormat } from "../src/adaptive.ts";
import { trimPlayerAnswer, trimYtDlpInfo } from "../src/answer-trim.ts";
import { CLIENTS, PLAYER_URL, playerBody } from "../src/innertube-context.ts";
import { offlineFile, offlineFormats, parseOfflineManifest } from "../src/offline-hd.ts";
import { pickCaptionTrack } from "../src/transcript.ts";
import type { YtDlpInfo } from "../src/ytdlp-info.ts";
import { FIXTURE_EXPIRE, FIXTURE_HOST, rewriteUrl, rewriteUrls } from "./fixture-format.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const offline = flag("--offline");
const videoId = offline ? "synthetic" : args.find((a) => !a.startsWith("--") && a !== flag("--name"));
if (!videoId) {
  console.log("usage: node tools/record-fixtures.ts <videoId> | --offline <folder> --name <dir>");
  process.exit(1);
}
const name = flag("--name") ?? videoId;
const out = new URL(`../tests/fixtures/replay/${name}/`, import.meta.url).pathname;
mkdirSync(join(out, "bytes"), { recursive: true });
mkdirSync(join(out, "captions"), { recursive: true });

const HEAD_BYTES = 64 * 1024;
let info: YtDlpInfo;
let fetchRange: FetchRange;
let player: unknown = null;
let captionText: string | null = null;
let budget: { ytDlp: () => void } | null = null;

if (offline) {
  const manifest = parseOfflineManifest(readFileSync(join(offline, "offline.json"), "utf8"));
  if (!manifest) throw new Error(`${offline}/offline.json is not an offline HD manifest`);
  info = {
    duration: 100,
    formats: [
      ...offlineFormats(manifest),
      { format_id: "18", url: "https://offline-hd.invalid/360.mp4", protocol: "https", ext: "mp4",
        vcodec: "avc1.42001E", acodec: "mp4a.40.2", width: 640, height: 360 },
    ],
    heatmap: Array.from({ length: 100 }, (_, i) => ({ start_time: i, end_time: i + 1, value: i === 42 ? 1 : 0.1 })),
    automatic_captions: { en: [{ ext: "json3", url: "https://www.youtube.com/api/timedtext?lang=en&fmt=json3" }] },
  };
  captionText = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: "A synthetic video" }] },
      { tStartMs: 4000, dDurationMs: 4000, segs: [{ utf8: "for the replay tests." }] },
    ],
  });
  fetchRange = async (url, start, end) => {
    const file = offlineFile(url);
    if (!file) throw new Error(`not an offline URL: ${url}`);
    const handle = await fs.open(join(offline, file), "r");
    try {
      const buf = Buffer.alloc(end - start + 1);
      const { bytesRead } = await handle.read(buf, 0, buf.length, start);
      return buf.buffer.slice(0, bytesRead) as ArrayBuffer;
    } finally {
      await handle.close();
    }
  };
} else {
  const { liveGuard } = await import("./live-budget.mjs");
  budget = liveGuard("record-fixtures");
  const bin = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"].find((p) => {
    try {
      execFileSync(p, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }) ?? "yt-dlp";
  budget.ytDlp();
  info = JSON.parse(
    execFileSync(bin, ["--no-warnings", "--no-playlist", "--skip-download", "-J", `https://www.youtube.com/watch?v=${videoId}`],
      { encoding: "utf8", maxBuffer: 64 << 20 }),
  ) as YtDlpInfo;
  const { ctx, ua } = CLIENTS.android;
  const res = await fetch(PLAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({ ...playerBody(videoId), context: { client: { ...ctx, hl: "en", gl: "US" } } }),
  });
  player = await res.json();
  const track = pickCaptionTrack(info, "en");
  if (track) captionText = await (await fetch(track.url)).text();
  fetchRange = async (url, start, end) => {
    const r = await fetch(withRange(url, start, end));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  };
}

// Each HD file's opening, through the end of its index.
const itagOf = (f: YtDlpFormat): string => f.format_id ?? "0";
const recorded: string[] = [];
for (const f of ytDlpCandidates(info.formats ?? [])) {
  let head = new Uint8Array(await fetchRange(f.url!, 0, HEAD_BYTES - 1));
  const at = locateIndex(head.buffer as ArrayBuffer);
  if (!at) {
    console.log(`  ${itagOf(f)}: no sidx in the opening, skipped`);
    continue;
  }
  if (at.index.end >= head.length) {
    const rest = new Uint8Array(await fetchRange(f.url!, head.length, at.index.end));
    head = new Uint8Array([...head, ...rest]);
  }
  writeFileSync(join(out, "bytes", `${itagOf(f)}.bin`), head.slice(0, at.index.end + 1));
  recorded.push(`${itagOf(f)} (${f.height ? `${f.height}p` : "audio"})`);
}

// URLs last, after every read is done.
const fixtureUrl = (f: YtDlpFormat): string =>
  offline ? `${FIXTURE_HOST}v/${itagOf(f)}?expire=${FIXTURE_EXPIRE}` : rewriteUrl(f.url ?? "");
const trimmed = trimYtDlpInfo(info, ["en"]);
trimmed.formats = (trimmed.formats ?? []).map((f) => ({ ...f, url: f.url && fixtureUrl(f) }));
writeFileSync(join(out, "ytdlp.json"), JSON.stringify(rewriteUrls(trimmed), null, 1) + "\n");
if (player) writeFileSync(join(out, "player-android.json"), JSON.stringify(rewriteUrls(trimPlayerAnswer(player)), null, 1) + "\n");
if (captionText) writeFileSync(join(out, "captions", "en.json3"), captionText);
writeFileSync(
  join(out, "about.json"),
  JSON.stringify({ source: offline ? "tools/make-offline-hd.mjs (synthetic)" : `youtube:${videoId}`,
    recordedAt: new Date().toISOString().slice(0, 10), files: recorded }, null, 1) + "\n",
);
console.log(`Recorded ${name}: ${recorded.join(", ")}`);
