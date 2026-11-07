/**
 * The yt-dlp resolver. Desktop only, and never imported at the top of a file
 * that mobile loads — the `child_process` import below is what kills the plugin
 * on iOS, and it throws at module load, long before any call-site guard runs.
 * Reach this file through `await import("./desktop")` inside a
 * `Platform.isDesktopApp` branch.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { ResolveError, YtDlpMissingError } from "../stream.ts";
import { fastStreamFromInfo, hlsStreamFromInfo } from "../ytdlp-info.ts";
import type { YtDlpInfo } from "../ytdlp-info.ts";
import { ytDlpEnv } from "./env.ts";
import { botCheck, isBotCheck } from "../bot-check.ts";
// `import type` and not a plain import: `node --test` strips types rather than
// compiling them, so a type imported as a value makes the whole module fail to
// load — which is what stopped `npm run smoke` running at all.
import type { ResolvedStream, ResolveMode } from "../stream.ts";

const pExecFile = promisify(execFile);

/** Re-exported: callers of the resolver have always found it here. */
export { isBotCheck };

/**
 * Run yt-dlp once. `cookieFile` signs the request in, and is only passed when
 * the user asked for it ("Try signed in"): there is no automatic signed-in
 * retry any more, because on a flagged network it doubled every request and
 * put the account's standing behind each one (GitHub #31). A bot check pauses
 * the plugin's automatic requests (`botCheck`) before the error goes on.
 */
async function ytDlp(
  ytDlpPath: string,
  args: string[],
  maxBuffer: number,
  cookieFile?: string,
): Promise<string> {
  try {
    const result = await pExecFile(ytDlpPath, [...(cookieFile ? ["--cookies", cookieFile] : []), ...args], {
      timeout: 120_000,
      maxBuffer,
      env: ytDlpEnv(ytDlpPath),
    });
    return result.stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const error = new ResolveError((e.stderr || e.message || "unknown error").trim());
    if (isBotCheck(error)) botCheck.trip();
    throw error;
  }
}

/**
 * Obsidian's Electron process does not inherit a login shell's PATH, so a bare
 * "yt-dlp" lookup fails even when it works in Terminal. Probe the known install
 * locations directly.
 */
const CANDIDATE_PATHS = [
  "/opt/homebrew/bin/yt-dlp",
  "/usr/local/bin/yt-dlp",
  "/usr/bin/yt-dlp",
  "/opt/local/bin/yt-dlp",
];

export async function findYtDlp(configuredPath: string): Promise<string> {
  const candidates = configuredPath
    ? [configuredPath, ...CANDIDATE_PATHS]
    : CANDIDATE_PATHS;

  for (const path of candidates) {
    try {
      await pExecFile(path, ["--version"], { timeout: 10_000 });
      return path;
    } catch {
      // try the next candidate
    }
  }
  throw new YtDlpMissingError();
}

export async function getVersion(ytDlpPath: string): Promise<string> {
  const { stdout } = await pExecFile(ytDlpPath, ["--version"], {
    timeout: 10_000,
    env: ytDlpEnv(ytDlpPath),
  });
  return stdout.trim();
}

/**
 * Everything yt-dlp knows about a video, in one run (GitHub #32): the 360p
 * file, the HD files, the sound alone, captions and the replay heatmap. Its
 * default client set, never a pinned one: one identity per open, and the set
 * whose files serve the whole video (measured 2026-11-04). `cookieFile` only
 * when the reader chose "Try signed in".
 */
export async function fetchYtDlpInfo(videoId: string, ytDlpPath: string, cookieFile?: string): Promise<YtDlpInfo> {
  const stdout = await ytDlp(
    ytDlpPath,
    ["--no-warnings", "--no-playlist", "--skip-download", "-J", `https://www.youtube.com/watch?v=${videoId}`],
    // Info JSON for a long video with 150+ caption languages runs to megabytes.
    64 * 1024 * 1024,
    cookieFile,
  );
  try {
    return JSON.parse(stdout) as YtDlpInfo;
  } catch {
    throw new ResolveError("yt-dlp's answer was not JSON");
  }
}

/**
 * One playable stream from one `-J`: the single 360p file for "fast", an HLS
 * variant (else that file) for "quality". The app builds HD from the same
 * answer instead (`resolveHdFromYtDlp`); this is the canary's path, and the
 * shape the live tests check.
 */
export async function resolveStream(
  videoId: string,
  ytDlpPath: string,
  mode: ResolveMode,
  cookieFile?: string,
): Promise<ResolvedStream> {
  const info = await fetchYtDlpInfo(videoId, ytDlpPath, cookieFile);
  return mode === "quality" ? (hlsStreamFromInfo(info) ?? fastStreamFromInfo(info)) : fastStreamFromInfo(info);
}
