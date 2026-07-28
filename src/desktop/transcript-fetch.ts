/**
 * The one half of the transcript feature that needs yt-dlp. Desktop only —
 * see the note at the top of `desktop/resolver.ts`. Everything that parses or
 * renders what this returns stays in `../transcript.ts`, with its tests.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { VideoInfo } from "../transcript.ts";

const pExecFile = promisify(execFile);

/**
 * One `yt-dlp -J` call answers both features: it lists every caption track with
 * a signed, immediately-usable URL, and it carries the replay heatmap. Takes
 * about three seconds. Doing it twice would be three seconds wasted.
 */
export async function fetchVideoInfo(ytDlpPath: string, videoId: string): Promise<VideoInfo> {
  const { stdout } = await pExecFile(
    ytDlpPath,
    [
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      "-J",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    // Info JSON for a long video with 150+ caption languages runs to megabytes.
    { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as VideoInfo;
}
