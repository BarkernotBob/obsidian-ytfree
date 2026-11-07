/**
 * The one half of the transcript feature that needs yt-dlp. Desktop only —
 * see the note at the top of `desktop/resolver.ts`. Everything that parses or
 * renders what this returns stays in `../transcript.ts`, with its tests.
 */

import { fetchYtDlpInfo } from "./resolver.ts";
import type { VideoInfo } from "../transcript.ts";

/**
 * One `yt-dlp -J` call answers both features: it lists every caption track with
 * a signed, immediately-usable URL, and it carries the replay heatmap. The app
 * takes this from the same `-J` as playback (GitHub #32); this stays for tools.
 */
export async function fetchVideoInfo(ytDlpPath: string, videoId: string): Promise<VideoInfo> {
  return fetchYtDlpInfo(videoId, ytDlpPath);
}
