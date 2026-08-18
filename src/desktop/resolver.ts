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

/**
 * The clients the fast path asks, in the order it asks them.
 *
 * A pinned client is what makes "fast" fast — the default set costs a lookup
 * per client — but a pinned client is also a single point of failure, and on
 * 2026-08-17 it failed: `android_vr` still *resolved*, and every URL it handed
 * back answered 403 to the first byte requested. Not a header mismatch, either;
 * yt-dlp's own downloader got the same 403. Nothing played, and resolution
 * looked healthy the whole time, which is why the list and the probe below both
 * exist now. `""` means yt-dlp's own default set: slower, but it is the thing
 * that keeps working when a pin dies.
 */
const FAST_CLIENTS = ["tv_simply", "web_safari", ""];

/** The quality path stays on the default set: HLS is what it is looking for. */
const QUALITY_CLIENTS = [""];

/**
 * Does this URL actually serve bytes?
 *
 * The 403 above is invisible to `-g`, which only asks YouTube where the stream
 * is. One range request for two bytes is the difference between finding out
 * here — where there is another client to try — and finding out in the
 * `<video>` element, where the only thing left to do is show an error.
 */
export async function servesBytes(url: string): Promise<boolean> {
  const control = new AbortController();
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-1" }, signal: control.signal });
    // 206 for a byte range, 200 for an HLS manifest, which ignores the header.
    const ok = res.status === 200 || res.status === 206;
    control.abort();
    return ok;
  } catch {
    // A network error is not evidence against the URL — the probe is meant to
    // catch a stream YouTube is refusing, not to fail the resolve when the wifi
    // drops. Treated as "no opinion", which is `true` here: the caller has a
    // playable-looking URL and the player has its own recovery for the rest.
    return true;
  }
}

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
  const clients = mode === "quality" ? QUALITY_CLIENTS : FAST_CLIENTS;
  let fallback: ResolvedStream | null = null;
  let lastError: unknown = null;

  for (const client of clients) {
    let stream: ResolvedStream;
    try {
      stream = await resolveWith(videoId, ytDlpPath, mode, client);
    } catch (err) {
      lastError = err;
      continue; // a client that cannot answer is not a video that cannot play
    }
    if (await servesBytes(stream.url)) return stream;
    fallback ??= stream;
  }

  // Nothing served. On the fast path hand back the first URL anyway — the probe
  // can be wrong and a player with a URL has a recovery path, while a player
  // with an exception has an error message. On the quality path throw instead:
  // `upgrade` catches it and keeps the 360p stream that is already playing,
  // which is strictly better than swapping it for one that answers 403.
  if (mode !== "quality" && fallback) return fallback;
  if (lastError) throw lastError;
  throw new ResolveError("no client returned a stream that plays");
}

/** One resolve, against one client — `""` for yt-dlp's own default set. */
async function resolveWith(
  videoId: string,
  ytDlpPath: string,
  mode: ResolveMode,
  client: string,
): Promise<ResolvedStream> {
  // The pinned clients only carry 360p, so ask for it directly rather than
  // waiting on an HLS lookup that will not exist.
  const selector = mode === "quality" ? "b[protocol^=m3u8]/18/b" : "18/b";
  const clientArgs = client ? ["--extractor-args", `youtube:player_client=${client}`] : [];

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
