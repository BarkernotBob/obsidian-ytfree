/**
 * The yt-dlp resolver. Desktop only, and never imported at the top of a file
 * that mobile loads — the `child_process` import below is what kills the plugin
 * on iOS, and it throws at module load, long before any call-site guard runs.
 * Reach this file through `await import("./desktop")` inside a
 * `Platform.isDesktopApp` branch.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import {
  EXPIRY_SAFETY_MARGIN_MS,
  parseExpiry,
  ResolveError,
  ResolvedStream,
  ResolveMode,
  YtDlpMissingError,
} from "../stream.ts";

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
