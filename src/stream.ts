/**
 * Everything about a resolved stream that does not care how it was resolved.
 *
 * This file exists because of the mobile split. Desktop resolves with yt-dlp
 * (`child_process`) and mobile resolves with InnerTube (`requestUrl`), but the
 * player, the cache, and the URL parsing are identical either way — and they
 * used to live in `resolver.ts`, whose `child_process` import throws at module
 * load on iOS. Nothing in here may import a Node builtin or `obsidian`.
 */

/** Treat a URL as expired this far ahead of its stated expiry. */
export const EXPIRY_SAFETY_MARGIN_MS = 10 * 60 * 1000;

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
 *
 * Mobile only ever answers "fast": InnerTube's single muxed format is 360p, and
 * everything above it needs MSE (issue 005).
 */
export type ResolveMode = "fast" | "quality";

export interface ResolvedStream {
  url: string;
  isHls: boolean;
  mode: ResolveMode;
  /** Epoch ms, already reduced by the safety margin. */
  expiresAt: number;
}

/**
 * How a player asks for a stream. The player never learns which platform it is
 * on — it gets one of these and that is the whole contract.
 */
export type StreamProvider = (
  mode: ResolveMode,
  forceRefresh: boolean,
) => Promise<ResolvedStream>;

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
  return extractVideoIds(input)[0] ?? null;
}

/**
 * Every video ID in a URL, in order.
 *
 * Usually one. The exception is YouTube's ad-hoc playlist URL
 * (`/watch_videos?video_ids=a,b,c`, commas often percent-encoded), which names
 * no single video at all — it is a whole queue. Callers that can only play one
 * thing take the first; callers that can offer a choice use the list.
 */
export function extractVideoIds(input: string): string[] {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return [raw];

  // Ad-hoc playlist: pull the ids out of the video_ids param specifically, so a
  // stray 11-character token elsewhere in the URL cannot join the list.
  const list = raw.match(/[?&]video_ids=([^&#]+)/);
  if (list) {
    const decoded = decodeURIComponent(list[1]);
    const ids = decoded.split(",").map((s) => s.trim()).filter((s) => /^[\w-]{11}$/.test(s));
    if (ids.length) return ids;
  }

  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) return [m[1]];
  }
  return [];
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

/**
 * In-memory only. Nothing here is ever written to a note or to disk — that is
 * what makes a note still play a year after it was written.
 *
 * On mobile that rule hardens into a requirement: googlevideo URLs are
 * IP-locked, so a URL resolved on the Mac and synced through the vault would
 * 403 on cellular. The cache is per-process for exactly that reason.
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
