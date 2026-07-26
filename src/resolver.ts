import { execFile } from "child_process";
import { promisify } from "util";

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

/** Treat a URL as expired this far ahead of its stated expiry. */
const EXPIRY_SAFETY_MARGIN_MS = 10 * 60 * 1000;

/** Used only when a URL carries no parseable expiry at all. */
const FALLBACK_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Which extraction path to use.
 *
 * Measured 2026-07-26: yt-dlp's default client rotation takes ~28s to return a
 * 1080p HLS manifest, because it queries several player clients in sequence and
 * waits on each. The android_vr client answers in ~4s but only offers the 360p
 * progressive format. Neither is acceptable alone, so the player loads "fast"
 * first and upgrades to "quality" in the background.
 */
export type ResolveMode = "fast" | "quality";

const FAST_CLIENT_ARGS = ["--extractor-args", "youtube:player_client=android_vr"];

export interface ResolvedStream {
  url: string;
  isHls: boolean;
  mode: ResolveMode;
  /** Epoch ms, already reduced by the safety margin. */
  expiresAt: number;
}

export class YtDlpMissingError extends Error {
  constructor() {
    super("yt-dlp not found");
    this.name = "YtDlpMissingError";
  }
}

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}

/** Pull an 11-character video ID out of any common YouTube URL shape. */
export function extractVideoId(input: string): string | null {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;

  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Googlevideo states expiry two different ways: a query param on direct
 * videoplayback URLs, and a path segment on HLS manifest URLs. Handle both.
 */
export function parseExpiry(url: string): number {
  const fromQuery = url.match(/[?&]expire=(\d+)/);
  if (fromQuery) return Number(fromQuery[1]) * 1000;

  const fromPath = url.match(/\/expire\/(\d+)/);
  if (fromPath) return Number(fromPath[1]) * 1000;

  return Date.now() + FALLBACK_LIFETIME_MS;
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

/**
 * In-memory only. Nothing here is ever written to a note or to disk — that is
 * what makes a note still play a year after it was written.
 */
export class StreamCache {
  private entries = new Map<string, ResolvedStream>();

  private key(videoId: string, mode: ResolveMode): string {
    return `${videoId}:${mode}`;
  }

  get(videoId: string, mode: ResolveMode): ResolvedStream | null {
    const k = this.key(videoId, mode);
    const hit = this.entries.get(k);
    if (!hit) return null;
    if (Date.now() >= hit.expiresAt) {
      this.entries.delete(k);
      return null;
    }
    return hit;
  }

  set(videoId: string, stream: ResolvedStream): void {
    this.entries.set(this.key(videoId, stream.mode), stream);
  }

  /** Drop both modes for a video, so a refresh re-resolves from scratch. */
  invalidate(videoId: string): void {
    this.entries.delete(this.key(videoId, "fast"));
    this.entries.delete(this.key(videoId, "quality"));
  }

  clear(): void {
    this.entries.clear();
  }
}
