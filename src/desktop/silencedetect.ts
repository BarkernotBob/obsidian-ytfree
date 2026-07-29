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
import { createSilencedetectStream } from "../silence.ts";
import type { SilenceWindow } from "../silence.ts";

export interface SilenceDetectOptions {
  ffmpegPath: string;
  /** A URL or a local file path — ffmpeg does not care which. */
  input: string;
  /** Silence threshold in dBFS, e.g. -30. */
  noiseDb: number;
  /** Minimum silence length in seconds. The user's setting, unchanged. */
  minGap: number;
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
  const args = [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-i",
    opts.input,
    "-vn",
    "-af",
    `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minGap}`,
    "-f",
    "null",
    "-",
  ];

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
      const windows = stream.push(chunk);
      if (windows.length) opts.onWindows(windows);
    });

    child.on("error", (err) => {
      if (cancelled) resolve();
      else reject(err);
    });

    child.on("close", (code) => {
      const rest = stream.flush();
      if (rest.length && !cancelled) opts.onWindows(rest);
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
