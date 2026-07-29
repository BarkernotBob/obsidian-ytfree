/**
 * Prove the chunked silence producer against a real audio URL.
 *
 * The one thing that cannot be unit-tested and would silently produce a
 * plausible, wrong map: silencedetect reports timestamps relative to `-ss`, so a
 * chunk's windows have to be shifted before they mean anything. This runs the
 * real thing and checks the shifted windows against a single-stream analysis of
 * the same stretch — if the offset were wrong, the two would not line up.
 *
 *   node spikes/silence-chunks/run.mjs [videoId]
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { detectSilence, detectSilenceChunked } from "../../src/desktop/silencedetect.ts";

const pExecFile = promisify(execFile);
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const YTDLP = "/opt/homebrew/bin/yt-dlp";
const videoId = process.argv[2] ?? "aircAruvnKk";
const WINDOW = 240;

const url = `https://www.youtube.com/watch?v=${videoId}`;
const { stdout } = await pExecFile(YTDLP, ["--no-warnings", "--no-playlist", "-f", "ba/bestaudio", "-g", url]);
const input = stdout.trim().split("\n").filter(Boolean).pop();

const opts = { ffmpegPath: FFMPEG, input, noiseDb: -30, minGap: 0.5 };

console.log(`chunked, first ${WINDOW}s, 4 workers…`);
const chunked = [];
const startedAt = Date.now();
let frontier = 0;
await detectSilenceChunked({
  ...opts,
  duration: WINDOW,
  playheadSeconds: 0,
  workers: 4,
  onWindows: (batch) => chunked.push(...batch),
  onProgress: (reached) => (frontier = reached),
}).done;
const chunkedSeconds = (Date.now() - startedAt) / 1000;

console.log(`single stream, same ${WINDOW}s…`);
const single = [];
const singleAt = Date.now();
await detectSilence({ ...opts, to: WINDOW, onWindows: (batch) => single.push(...batch) }).done;
const singleSeconds = (Date.now() - singleAt) / 1000;

const near = (a, b) => Math.abs(a - b) < 0.5;
const matched = single.filter((w) => chunked.some((c) => near(c.start, w.start))).length;

console.log({
  chunkedWindows: chunked.length,
  singleWindows: single.length,
  matched,
  frontier,
  chunkedSeconds,
  singleSeconds,
  speedup: +(singleSeconds / chunkedSeconds).toFixed(2),
  lastChunkedStart: chunked.map((w) => w.start).sort((a, b) => a - b).pop(),
});

// The offset is right if the two analyses agree on where the pauses are, and if
// the chunked run reports windows out past the first chunk at all.
const ok = matched >= single.length * 0.9 && frontier >= WINDOW;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
