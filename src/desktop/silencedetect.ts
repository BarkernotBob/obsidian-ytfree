/**
 * The ffmpeg silence producer. Desktop only, optional, and never required.
 *
 * `child_process` at the top of the file, so this module lives under
 * `src/desktop/` and is reachable only through `await import("./desktop")` —
 * see `desktop/index.ts` for why that rule exists.
 *
 * What it buys over the transcript producer: caption timing cannot tell a pause
 * from an interlude, so an intro sting or a bar of music between sections gets
 * compressed like silence. ffmpeg measures the audio, and music is loud, so a
 * silencedetect map leaves it alone. If ffmpeg is not installed this file is
 * never loaded and nothing about the feature is missing — the map just stays
 * the one the captions produced.
 */

import { spawn } from "child_process";
import { createSilencedetectStream, mergeWindows, offsetWindows, planChunks } from "../silence.ts";
import type { SilenceChunk, SilenceWindow } from "../silence.ts";

export interface SilenceDetectOptions {
  ffmpegPath: string;
  /** A URL or a local file path — ffmpeg does not care which. */
  input: string;
  /** Silence threshold in dBFS, e.g. -30. */
  noiseDb: number;
  /** Minimum silence length in seconds. The user's setting, unchanged. */
  minGap: number;
  /**
   * Analyse only `[from, to)` of the input, and report in whole-video time.
   *
   * `-ss` goes **before** `-i`, which makes it an input seek: on an http input
   * ffmpeg issues a range request and pays for that chunk's bytes alone. The
   * catch, and it is the one mistake in this file that would produce a
   * completely plausible wrong map, is that silencedetect then reports
   * timestamps **relative to the seek point** — so every window is shifted back
   * by `from` before it leaves here.
   */
  from?: number;
  to?: number;
  /**
   * Called as windows are detected, not once at the end. silencedetect reports
   * progressively and an audio-only stream analyses far faster than realtime,
   * so a video that is already playing gets its map filled in underneath it.
   */
  onWindows: (windows: SilenceWindow[]) => void;
}

export interface SilenceDetectHandle {
  /** Kill the child. Safe to call twice, and safe after it has already exited. */
  cancel: () => void;
  /**
   * Resolves when the analysis finished cleanly, rejects if ffmpeg failed.
   * A cancel resolves — a job we stopped is not a job that went wrong.
   */
  done: Promise<void>;
}

/**
 * Run `silencedetect` over `input` and report windows as they arrive.
 *
 * `-vn` because a muxed URL would otherwise have its video decoded for nothing,
 * and `-f null -` because there is no output file: the filter's *log* is the
 * product. Nothing is written to disk at any point, which is what keeps this an
 * analysis rather than a download.
 */
export function detectSilence(opts: SilenceDetectOptions): SilenceDetectHandle {
  const from = opts.from && opts.from > 0 ? opts.from : 0;
  const args = [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    ...(from ? ["-ss", String(from)] : []),
    "-i",
    opts.input,
    ...(opts.to !== undefined ? ["-t", String(Math.max(0, opts.to - from))] : []),
    "-vn",
    "-af",
    `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minGap}`,
    "-f",
    "null",
    "-",
  ];
  const report = (windows: SilenceWindow[]): void => {
    if (windows.length) opts.onWindows(from ? offsetWindows(windows, from) : windows);
  };

  const child = spawn(opts.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  const stream = createSilencedetectStream();
  let cancelled = false;
  // Kept only so a non-zero exit can say what went wrong. Capped, because a
  // failing ffmpeg can be extremely talkative and this is a diagnostic, not a log.
  let tail = "";

  const done = new Promise<void>((resolve, reject) => {
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-4000);
      report(stream.push(chunk));
    });

    child.on("error", (err) => {
      if (cancelled) resolve();
      else reject(err);
    });

    child.on("close", (code) => {
      const rest = stream.flush();
      if (!cancelled) report(rest);
      if (cancelled || code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${tail.trim().split("\n").slice(-3).join(" ")}`));
    });
  });

  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      // SIGKILL and not SIGTERM: ffmpeg reading a stalled network stream can sit
      // in a blocking read for a long time before it notices a polite signal,
      // and this is called when a note closes.
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    },
    done,
  };
}

/**
 * How far from the start the analysis is unbroken.
 *
 * A run that finished chunks 4, 5 and 6 first has analysed nine minutes and can
 * still only claim a frontier of zero — which is the honest answer, and the one
 * that makes a resume correct.
 */
function contiguousFrontier(covered: SilenceWindow[], duration: number): number {
  const merged = mergeWindows(covered);
  const first = merged[0];
  if (!first || first.start > SILENCE_CHUNK_OVERLAP) return 0;
  return Math.min(duration, first.end);
}

/** How many chunks are analysed at once. See `detectSilenceChunked`. */
export const SILENCE_WORKERS = 6;
/** Seconds of video per chunk, and how much each one overreaches into the next. */
export const SILENCE_CHUNK_SECONDS = 60;
export const SILENCE_CHUNK_OVERLAP = 3;

export interface ChunkedSilenceOptions extends Omit<SilenceDetectOptions, "from" | "to"> {
  /** Whole-video duration in seconds. Without it there is nothing to divide. */
  duration: number;
  /** Where playback is, so the work starts where it is needed. */
  playheadSeconds: number;
  /** Already analysed from 0 to here; those chunks are skipped. */
  analyzedTo?: number;
  workers?: number;
  /**
   * Called after each chunk with the **contiguous** frontier: the second up to
   * which everything has been analysed.
   *
   * Contiguous and not "seconds covered", because chunks are done playhead-first
   * and so the covered region is full of holes early on. Only a prefix can be
   * stored as `analyzedTo` and resumed from, and only a prefix can be spliced
   * against the caption map without claiming ffmpeg knows about a stretch it has
   * not reached.
   */
  onProgress?: (frontierSeconds: number, totalSeconds: number) => void;
}

/**
 * The same analysis, run as a pool of chunks instead of one long stream.
 *
 * This exists because of a measurement, not a hunch: googlevideo throttles a
 * single connection to about 1.9× realtime, which is *slower than BarkernotBob
 * watches* — so 015's one-stream analysis could never catch the playhead, and
 * the feature looked dead. Six connections against the same file measured ~10×
 * (360 s of audio in 37 s). The throttle is per connection.
 *
 * Failures are per chunk and are swallowed: five chunks of a map is a better
 * answer than none, and Smart Speed is never allowed to be load-bearing. The
 * whole job rejects only if every chunk failed, which is what an unusable input
 * looks like.
 */
export function detectSilenceChunked(opts: ChunkedSilenceOptions): SilenceDetectHandle {
  const chunks = planChunks(
    opts.duration,
    opts.playheadSeconds,
    SILENCE_CHUNK_SECONDS,
    SILENCE_CHUNK_OVERLAP,
  ).filter((chunk) => chunk.end > (opts.analyzedTo ?? 0));

  let cancelled = false;
  const running = new Set<SilenceDetectHandle>();
  // Every stretch known to be analysed, this run and any previous one. Kept as
  // ranges rather than a number because the chunks do not finish in order.
  const covered: SilenceWindow[] = opts.analyzedTo ? [{ start: 0, end: opts.analyzedTo }] : [];
  let failures = 0;

  const runChunk = async (chunk: SilenceChunk): Promise<void> => {
    if (cancelled) return;
    const job = detectSilence({
      ffmpegPath: opts.ffmpegPath,
      input: opts.input,
      noiseDb: opts.noiseDb,
      minGap: opts.minGap,
      from: chunk.start,
      to: chunk.end,
      onWindows: opts.onWindows,
    });
    running.add(job);
    try {
      await job.done;
      covered.push({ start: chunk.start, end: chunk.end });
      opts.onProgress?.(contiguousFrontier(covered, opts.duration), opts.duration);
    } catch (err) {
      failures++;
      console.error(`YT Free: silence chunk ${chunk.start}–${chunk.end}s failed.`, err);
    } finally {
      running.delete(job);
    }
  };

  const done = (async () => {
    const queue = [...chunks];
    const workers = Math.max(1, opts.workers ?? SILENCE_WORKERS);
    await Promise.all(
      Array.from({ length: Math.min(workers, queue.length) }, async () => {
        for (let chunk = queue.shift(); chunk && !cancelled; chunk = queue.shift()) {
          await runChunk(chunk);
        }
      }),
    );
    if (!cancelled && chunks.length > 0 && failures === chunks.length) {
      throw new Error(`ffmpeg failed on all ${chunks.length} chunks`);
    }
  })();

  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      for (const job of running) job.cancel();
    },
    done,
  };
}
