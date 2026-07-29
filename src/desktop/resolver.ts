/**
 * The yt-dlp resolver. Desktop only, and never imported at the top of a file
 * that mobile loads — the `child_process` import below is what kills the plugin
 * on iOS, and it throws at module load, long before any call-site guard runs.
 * Reach this file through `await import("./desktop")` inside a
 * `Platform.isDesktopApp` branch.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { EXPIRY_SAFETY_MARGIN_MS, parseExpiry, ResolveError, YtDlpMissingError } from "../stream.ts";
// `import type` and not a plain import: `node --test` strips types rather than
// compiling them, so a type imported as a value makes the whole module fail to
// load — which is what stopped `npm run smoke` running at all.
import type { ResolvedStream, ResolveMode } from "../stream.ts";

const pExecFile = promisify(execFile);

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

const FAST_CLIENT_ARGS = ["--extractor-args", "youtube:player_client=android_vr"];

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

/**
 * The audio-only stream for a video, as one URL.
 *
 * For Smart Speed's ffmpeg producer, which needs to hear the video but has no
 * use for the picture. An audio track is roughly 1 MB a minute against 30–60 for
 * the muxed stream, so analysing the audio alone is the difference between a
 * background job and a second download — and ffmpeg reads it far faster than
 * realtime, so a map for a 40-minute video lands within the first minute of it.
 *
 * `ba` rather than a specific container: any audio format ffmpeg can decode is
 * fine here, and pinning `m4a` would fail on the videos that do not offer one.
 */
export async function resolveAudioUrl(videoId: string, ytDlpPath: string): Promise<string> {
  let stdout: string;
  try {
    const result = await pExecFile(
      ytDlpPath,
      [
        "--no-warnings",
        "--no-playlist",
        "-f",
        "ba/bestaudio",
        "-g",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new ResolveError((e.stderr || e.message || "unknown error").trim());
  }

  const url = stdout.trim().split("\n").filter(Boolean).pop();
  if (!url) throw new ResolveError("yt-dlp returned no audio URL");
  return url;
}

export async function getVersion(ytDlpPath: string): Promise<string> {
  const { stdout } = await pExecFile(ytDlpPath, ["--version"], { timeout: 10_000 });
  return stdout.trim();
}

/**
 * Resolve a video ID to a single playable stream URL.
 *
 * The format selector deliberately asks for a pre-muxed format ("b") so yt-dlp
 * returns exactly one URL. Asking for the best video+audio would return two
 * that need ffmpeg to merge, which we do not require.
 */
export async function resolveStream(
  videoId: string,
  ytDlpPath: string,
  mode: ResolveMode,
): Promise<ResolvedStream> {
  // "fast" pins the one client that answers quickly; it only has 360p, so ask
  // for that directly rather than waiting on an HLS lookup that will not exist.
  const selector = mode === "quality" ? "b[protocol^=m3u8]/18/b" : "18/b";
  const clientArgs = mode === "fast" ? FAST_CLIENT_ARGS : [];

  let stdout: string;
  try {
    const result = await pExecFile(
      ytDlpPath,
      [
        "--no-warnings",
        "--no-playlist",
        ...clientArgs,
        "-f",
        selector,
        "-g",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "unknown error").trim();
    throw new ResolveError(detail);
  }

  const url = stdout.trim().split("\n").filter(Boolean).pop();
  if (!url) throw new ResolveError("yt-dlp returned no stream URL");

  return {
    url,
    isHls: url.includes(".m3u8") || url.includes("/hls_playlist/"),
    mode,
    expiresAt: parseExpiry(url) - EXPIRY_SAFETY_MARGIN_MS,
  };
}
