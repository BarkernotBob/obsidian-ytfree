/**
 * The environment yt-dlp is spawned with. Desktop only.
 *
 * Obsidian's Electron process does not inherit a login shell's PATH — the same
 * fact `findYtDlp` works around by probing absolute paths — and on 2026-08-17
 * that turned out to matter for a second, much less visible reason: yt-dlp now
 * has to solve a JavaScript challenge to get playable formats out of several
 * YouTube clients, and it solves it by shelling out to `deno`. With a bare
 * PATH it cannot find one, so it quietly drops those clients and reports
 * "Requested format is not available" — a message that reads like the *video*
 * is the problem.
 *
 * That is what made the first attempt at the 403 fix work in a terminal and do
 * nothing in Obsidian: `tv_simply` needs the challenge solved, so inside
 * Obsidian it failed and the chain fell through to the clients that still
 * answer with a URL nobody is allowed to fetch.
 *
 * The two Homebrew prefixes are where `deno`, `node` and `ffmpeg` live on this
 * platform; yt-dlp's own directory goes first because whatever installed it is
 * the best guess at where its helpers are.
 */

import path from "path";

const HELPER_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/bin"];

/**
 * `process.env` with the helper directories added to PATH.
 *
 * Added rather than replaced, and appended rather than prepended: a PATH the
 * user has arranged deliberately should keep winning, and this only has to make
 * the difference between "not found" and "found".
 */
export function ytDlpEnv(ytDlpPath: string): NodeJS.ProcessEnv {
  const own = ytDlpPath ? [path.dirname(ytDlpPath)] : [];
  const existing = process.env.PATH ? process.env.PATH.split(":") : [];
  const seen = new Set<string>();
  const merged = [...existing, ...own, ...HELPER_PATHS].filter((dir) => {
    if (!dir || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
  return { ...process.env, PATH: merged.join(":") };
}
