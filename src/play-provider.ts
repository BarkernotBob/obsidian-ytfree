/**
 * The stream provider behind Play (GitHub #66).
 *
 * Kept free of `obsidian` so the request ceilings for Play and HD can be
 * tested against the real code (tests/player-ceilings.test.ts): the player,
 * this provider and the HD resolver together, with only the network faked.
 *
 * `cachedProvider` is the part every platform shares: the bot-check breaker,
 * the stream cache, and the refresh after a failed stream. `desktopResolve`
 * is where a desktop stream comes from: one `yt-dlp -J` per video for both
 * 360p and HD, and InnerTube only when yt-dlp is missing or fails.
 */
import type { FetchRange, YtDlpFormat } from "./adaptive.ts";
import { botCheck, isBotCheck } from "./bot-check.ts";
import { YtDlpMissingError } from "./stream.ts";
import type { ResolveMode, ResolvedStream, StreamCache, StreamProvider } from "./stream.ts";
import { fastStreamFromInfo, hlsStreamFromInfo } from "./ytdlp-info.ts";
import type { YtDlpInfo } from "./ytdlp-info.ts";

/**
 * Guard, then the cache, then `resolve`.
 *
 * HD lookups and recovery retries are automatic: none while paused. The first
 * resolve is the reader pressing Play, and goes when a retry is due (1, 5, 10,
 * 30 min, 1 h, 2 h, then every 6 h). `forget` drops whatever else the
 * platform keeps for the video, so a refresh really asks again.
 */
export function cachedProvider(
  videoId: string,
  cache: StreamCache,
  resolve: (mode: ResolveMode) => Promise<ResolvedStream>,
  forget: () => void,
): StreamProvider {
  return async (mode, forceRefresh) => {
    if (mode === "quality" || forceRefresh) botCheck.guard();
    else botCheck.guardPlay();
    if (forceRefresh) {
      cache.invalidate(videoId);
      forget();
    }
    const cached = cache.get(videoId, mode);
    if (cached) return cached;
    const stream = await resolve(mode);
    cache.set(videoId, stream);
    return stream;
  };
}

/** Where a desktop stream comes from. Supplied by the plugin; faked in tests. */
export interface DesktopSources {
  /** The one kept `yt-dlp -J` answer for the video. */
  ytDlpInfo(videoId: string): Promise<YtDlpInfo>;
  /** True once yt-dlp is known to be absent, so it is not probed per video. */
  ytDlpUnavailable(): boolean;
  markYtDlpUnavailable(): void;
  /** 360p from InnerTube, the way the phone plays. */
  innertubeFast(videoId: string): Promise<ResolvedStream>;
  /** HD from InnerTube: only on a desktop without yt-dlp. */
  innertubeHd(videoId: string, fetch: FetchRange): Promise<ResolvedStream>;
  /** HD stitched from yt-dlp's formats, reading the file headers. */
  ytDlpHd(videoId: string, formats: YtDlpFormat[], fetch: FetchRange): Promise<ResolvedStream>;
  /** The byte-range reader HD uses. */
  rangeFetch(): Promise<FetchRange>;
  /** Called after a 360p stream came from InnerTube because yt-dlp is missing. */
  onPlayingWithoutYtDlp(): void;
}

/** A desktop resolver for `cachedProvider`. */
export function desktopResolve(
  videoId: string,
  src: DesktopSources,
): (mode: ResolveMode) => Promise<ResolvedStream> {
  return (mode) => (mode === "quality" ? desktopQuality(videoId, src) : desktopFast(videoId, src));
}

/**
 * yt-dlp when it is there. When it is missing, or fails, the desktop resolves
 * the way the phone does rather than showing an install message.
 */
async function desktopFast(videoId: string, src: DesktopSources): Promise<ResolvedStream> {
  let ytDlpError: unknown = null;
  if (!src.ytDlpUnavailable()) {
    try {
      return fastStreamFromInfo(await src.ytDlpInfo(videoId));
    } catch (err) {
      // Tried once. Asking InnerTube next is more of what flagged the network.
      if (isBotCheck(err)) throw err;
      ytDlpError = err;
      // Probing four paths on every video is not worth it once it is known
      // to be absent. A resolve failure is per-video, so it is not kept.
      if (err instanceof YtDlpMissingError) src.markYtDlpUnavailable();
    }
  }

  try {
    const stream = await src.innertubeFast(videoId);
    if (src.ytDlpUnavailable()) src.onPlayingWithoutYtDlp();
    return stream;
  } catch (fallbackError) {
    // Report the yt-dlp failure when there was one: its message is the one
    // the error box knows how to explain.
    throw ytDlpError ?? fallbackError;
  }
}

/**
 * The stitched HD stream built from the same `yt-dlp -J` answer, or an HLS
 * variant from it. InnerTube is asked for HD only on a desktop without
 * yt-dlp: its files mostly stop serving at about a minute.
 */
async function desktopQuality(videoId: string, src: DesktopSources): Promise<ResolvedStream> {
  const fetch = await src.rangeFetch();
  if (src.ytDlpUnavailable()) return src.innertubeHd(videoId, fetch);

  const info = await src.ytDlpInfo(videoId);
  try {
    return await src.ytDlpHd(videoId, info.formats ?? [], fetch);
  } catch (err) {
    // The odd video with an HLS ladder and no MP4 pair. No new request.
    const hls = hlsStreamFromInfo(info);
    if (hls) return hls;
    throw err;
  }
}
