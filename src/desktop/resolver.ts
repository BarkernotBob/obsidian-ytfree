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
import { governor } from "../request-governor.ts";
import {
  AgeRestrictedError,
  YTDLP_AGE_LIMIT,
  isAdultAgeLimit,
  isAgeRestricted,
  reportAgeRestricted,
} from "../age-restricted.ts";
// `import type` and not a plain import: `node --test` strips types rather than
// compiling them, so a type imported as a value makes the whole module fail to
// load — which is what stopped `npm run smoke` running at all.
import type { ResolvedStream, ResolveMode } from "../stream.ts";

const pExecFile = promisify(execFile);

/** Re-exported: callers of the resolver have always found it here. */
export { isBotCheck };

/**
 * Run yt-dlp once, always signed out: no cookies are ever passed (GitHub #64).
 * A bot check pauses the plugin's automatic requests (`botCheck`) before the
 * error goes on.
 */
async function ytDlp(ytDlpPath: string, args: string[], maxBuffer: number): Promise<string> {
  const sentAt = Date.now();
  try {
    // Paced with the other "who is this video" requests (GitHub #36).
    const result = await governor.run("yt-dlp", () =>
      pExecFile(ytDlpPath, args, {
        timeout: 120_000,
        maxBuffer,
        env: ytDlpEnv(ytDlpPath),
      }),
    );
    // An answer during a bot-check pause ends it (GitHub #66).
    botCheck.succeeded(sentAt);
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
  // Last: whatever the app's own PATH finds. The only candidate that can match
  // on Windows, and the one that finds `~/.local/bin` on Linux.
  "yt-dlp",
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
 * whose files serve the whole video (measured 2026-11-04).
 */
export async function fetchYtDlpInfo(videoId: string, ytDlpPath: string): Promise<YtDlpInfo> {
  let stdout: string;
  try {
    stdout = await ytDlp(
      ytDlpPath,
      [
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        // Refuse 18+ (GitHub #111). With `-J` a refused video still prints its
        // JSON, carrying `age_limit: 18`, which is checked below.
        "--age-limit",
        String(YTDLP_AGE_LIMIT),
        "-J",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      // Info JSON for a long video with 150+ caption languages runs to megabytes.
      64 * 1024 * 1024,
    );
  } catch (err) {
    // "Sign in to confirm your age": blocked, never retried (GitHub #111).
    if (isAgeRestricted(err)) throw ageRestricted(videoId);
    throw err;
  }
  let info: YtDlpInfo;
  try {
    info = JSON.parse(stdout) as YtDlpInfo;
  } catch {
    throw new ResolveError("yt-dlp's answer was not JSON");
  }
  if (isAdultAgeLimit((info as { age_limit?: unknown } | null)?.age_limit)) throw ageRestricted(videoId);
  return info;
}

function ageRestricted(videoId: string): AgeRestrictedError {
  reportAgeRestricted(videoId);
  return new AgeRestrictedError(videoId);
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
): Promise<ResolvedStream> {
  const info = await fetchYtDlpInfo(videoId, ytDlpPath);
  return mode === "quality" ? (hlsStreamFromInfo(info) ?? fastStreamFromInfo(info)) : fastStreamFromInfo(info);
}
