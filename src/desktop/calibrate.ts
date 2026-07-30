/**
 * Measuring a video's noise floor, so `silencedetect` can be told where silence
 * actually is on *this* recording.
 *
 * Sits beside `silencedetect.ts` and for the same reason: it spawns ffmpeg, so
 * it lives under `src/desktop/` and is reachable only through
 * `await import("./desktop")`. If ffmpeg is missing this file is never loaded,
 * and the transcript producer carries the feature by itself.
 *
 * The decision — what threshold the numbers imply — is not here. That is
 * `pickThreshold` in `silence.ts`, where it can be tested without ffmpeg
 * installed. This file only turns audio into a list of levels.
 */

import { spawn } from "child_process";
import { parseAstatsPeaks, pickThreshold, UNCALIBRATED_NOISE_DB } from "../silence.ts";
import type { ThresholdChoice } from "../silence.ts";

/** How much audio the measurement listens to, in seconds. */
export const CALIBRATION_SECONDS = 60;
/**
 * Samples per analysis window: 4800 at 48 kHz is 100 ms.
 *
 * astats otherwise reports per *frame*, whose length depends on the codec, and
 * a threshold read off windows of unknown length is not reproducible.
 * `asetnsamples` forces them to a size the numbers can be compared across
 * videos at. 100 ms is short enough to sit inside a pause between words.
 */
export const CALIBRATION_WINDOW_SAMPLES = 4800;
/** Long enough for a slow network chunk, short enough not to stall playback. */
const CALIBRATION_TIMEOUT_MS = 45_000;

export interface CalibrateOptions {
  ffmpegPath: string;
  /** A URL or a local file path, same as `detectSilence`. */
  input: string;
  /** Where in the video to listen. Defaults to the start. */
  from?: number;
  seconds?: number;
  /** The user's Advanced override, if they moved it off the default. */
  floorMargin?: number;
}

/**
 * Read one stretch of the audio and report the peak level of every 100 ms of it.
 *
 * `-vn`, `-f null -` and nothing written to disk, exactly as in
 * `silencedetect.ts`: the filter's log is the product. Rejects if ffmpeg fails,
 * because a caller that cannot tell "quiet video" from "ffmpeg is broken" would
 * calibrate to garbage.
 */
export function measurePeakLevels(opts: CalibrateOptions): Promise<number[]> {
  const from = opts.from && opts.from > 0 ? opts.from : 0;
  const args = [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    ...(from ? ["-ss", String(from)] : []),
    "-i",
    opts.input,
    "-t",
    String(opts.seconds ?? CALIBRATION_SECONDS),
    "-vn",
    "-af",
    `asetnsamples=n=${CALIBRATION_WINDOW_SAMPLES}:p=0,astats=metadata=1:reset=1,` +
      "ametadata=mode=print:key=lavfi.astats.Overall.Peak_level",
    "-f",
    "null",
    "-",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(opts.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let text = "";
    let settled = false;

    // A stalled network read can hang ffmpeg indefinitely, and this runs before
    // the analysis it gates. Better to fall back than to never start.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      reject(new Error(`calibration timed out after ${CALIBRATION_TIMEOUT_MS} ms`));
    }, CALIBRATION_TIMEOUT_MS);

    const finish = (err: Error | null, levels?: number[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(levels ?? []);
    };

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      text += chunk;
    });
    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(`ffmpeg exited ${code}: ${text.trim().split("\n").slice(-3).join(" ")}`));
        return;
      }
      finish(null, parseAstatsPeaks(text));
    });
  });
}

/**
 * The threshold to run `silencedetect` at for this video.
 *
 * Never throws. A failed measurement is not a reason to leave Smart Speed
 * broken, and the fallback errs quiet — see `UNCALIBRATED_NOISE_DB`. Callers
 * run this **once per video per run** and pass the result to every chunk:
 * calibrating per chunk would let the threshold drift between minute 3 and
 * minute 4 of the same recording.
 */
export async function calibrateThreshold(opts: CalibrateOptions): Promise<ThresholdChoice> {
  try {
    const peaks = await measurePeakLevels(opts);
    const choice = pickThreshold(peaks, opts.floorMargin);
    if (!choice.calibrated) {
      console.warn(`YT Free: calibration read only ${choice.samples} windows; using fallback.`);
    }
    return choice;
  } catch (err) {
    console.error("YT Free: silence calibration failed; using fallback threshold.", err);
    return { thresholdDb: UNCALIBRATED_NOISE_DB, calibrated: false, samples: 0 };
  }
}
