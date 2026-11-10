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
import { resolveByTier } from "./tier-failures.ts";
import type { TierFailures } from "./tier-failures.ts";
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
  failures?: TierFailures,
): StreamProvider {
  return async (mode, forceRefresh, deadLink = false) => {
    if (mode === "quality" || forceRefresh) botCheck.guard();
    else botCheck.guardPlay();
    if (forceRefresh) {
      // A 360p link still inside its lifetime that is being replaced did not
      // play: that tier failed for this video, and the next try moves on
      // (#43). An expired link is just re-resolved on the same tier.
      const live = cache.get(videoId, "fast");
      if (deadLink && mode === "fast" && live?.tier) failures?.mark(videoId, live.tier);
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

/**
 * Where a phone stream comes from: InnerTube. "fast" is the 360p single file;
 * "quality" is only asked for when HD on this phone is turned on, and is the
 * stitched stream (`adaptive.ts`). Loaded on first use: neither module is
 * needed until something plays.
 */
export function mobileResolve(
  videoId: string,
  failures: TierFailures,
  innertubeFast: (videoId: string) => Promise<ResolvedStream> = async (id) => {
    const { resolveMobileStream } = await import("./mobile/innertube.ts");
    return resolveMobileStream(id);
  },
): (mode: ResolveMode) => Promise<ResolvedStream> {
  return async (mode) => {
    if (mode === "quality") {
      const { resolvePhoneHdStream } = await import("./hd.ts");
      return resolvePhoneHdStream(videoId);
    }
    // One tier on the phone: when it has failed, `AllTiersFailedError`, and
    // the player hands the video to YouTube's (#43).
    return resolveByTier({
      videoId,
      tiers: () => ["own"],
      failures,
      resolve: () => innertubeFast(videoId),
      stop: isBotCheck,
    });
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
  /** Which tiers failed for which video (#43). */
  failures: TierFailures;
}

/** A desktop resolver for `cachedProvider`. */
export function desktopResolve(
  videoId: string,
  src: DesktopSources,
): (mode: ResolveMode) => Promise<ResolvedStream> {
  return (mode) => (mode === "quality" ? desktopQuality(videoId, src) : desktopFast(videoId, src));
}

/**
 * 360p: the next stream tier that has not failed for this video
 * (`choosePlayer`): yt-dlp if it is here, then our own stream. When both have
 * failed, `AllTiersFailedError`, and the player hands the video to YouTube's
 * (#43). Never an install or update message.
 */
function desktopFast(videoId: string, src: DesktopSources): Promise<ResolvedStream> {
  return resolveByTier({
    videoId,
    tiers: () => (src.ytDlpUnavailable() ? ["own"] : ["yt-dlp", "own"]),
    failures: src.failures,
    resolve: async (tier) => {
      if (tier === "yt-dlp") return fastStreamFromInfo(await src.ytDlpInfo(videoId));
      const stream = await src.innertubeFast(videoId);
      if (src.ytDlpUnavailable()) src.onPlayingWithoutYtDlp();
      return stream;
    },
    // Tried once. Asking InnerTube next is more of what flagged the network.
    stop: isBotCheck,
    onError: (_tier, err) => {
      // Probing four paths on every video is not worth it once it is known
      // to be absent. Absence is not this video's failure, so not marked.
      if (!(err instanceof YtDlpMissingError)) return true;
      src.markYtDlpUnavailable();
      return false;
    },
  });
}

/**
 * The stitched HD stream built from the same `yt-dlp -J` answer, or an HLS
 * variant from it. InnerTube is asked for HD only on a desktop without
 * yt-dlp: its files mostly stop serving at about a minute.
 */
async function desktopQuality(videoId: string, src: DesktopSources): Promise<ResolvedStream> {
  const fetch = await src.rangeFetch();
  // No yt-dlp, or its links would not play for this video (#43).
  if (src.ytDlpUnavailable() || src.failures.failed(videoId).has("yt-dlp")) {
    return src.innertubeHd(videoId, fetch);
  }

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
