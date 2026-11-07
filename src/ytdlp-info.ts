/**
 * One `yt-dlp -J` per video, and everything the desktop takes from it
 * (GitHub #32).
 *
 * Before, a new video on desktop ran yt-dlp up to four times: `-J` for the
 * transcript, `-g` for 360p on up to three clients, `-J` again for HD, and
 * `-g` for Smart Speed's audio. Every one of those answers is already in the
 * first `-J`. This file picks each of them out of it, and has no `obsidian`
 * or `child_process` import, so it is tested directly.
 */
import type { YtDlpFormat } from "./adaptive.ts";
import { EXPIRY_SAFETY_MARGIN_MS, parseExpiry, ResolveError } from "./stream.ts";
import type { ResolvedStream } from "./stream.ts";
import type { VideoInfo } from "./transcript.ts";

/** What `yt-dlp -J` says about a video, as far as the plugin reads it. */
export interface YtDlpInfo extends VideoInfo {
  formats?: YtDlpFormat[];
}

const has = (codec: string | null | undefined): boolean => !!codec && codec !== "none";
const https = (f: YtDlpFormat): boolean => !!f.url && (f.protocol ?? "https") === "https";

/**
 * The single file a bare `<video>` plays: itag 18 (360p, H.264 + AAC) when it
 * is there, as it is on almost every video, else the best other MP4 with both
 * picture and sound.
 */
export function pickProgressive(formats: YtDlpFormat[]): YtDlpFormat | null {
  const muxed = formats.filter((f) => https(f) && has(f.vcodec) && has(f.acodec) && f.ext === "mp4");
  return (
    muxed.find((f) => f.format_id === "18") ??
    muxed.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0] ??
    null
  );
}

/** An HLS variant with picture, the tallest at or under `maxHeight`. */
export function pickHls(formats: YtDlpFormat[], maxHeight = 1080): YtDlpFormat | null {
  return (
    formats
      .filter((f) => !!f.url && (f.protocol ?? "").startsWith("m3u8") && has(f.vcodec) && (f.height ?? 0) <= maxHeight)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0] ?? null
  );
}

/**
 * The sound alone, for Smart Speed's ffmpeg (about 1 MB a minute against
 * 30–60 for a picture). M4A first, as `-f ba` used to pick, then the highest
 * bitrate. Any audio ffmpeg decodes would do.
 */
export function pickAudioUrl(formats: YtDlpFormat[]): string | null {
  const audio = formats
    .filter((f) => https(f) && has(f.acodec) && !has(f.vcodec))
    .sort((a, b) => Number(b.ext === "m4a") - Number(a.ext === "m4a") || (b.tbr ?? 0) - (a.tbr ?? 0));
  return audio[0]?.url ?? null;
}

/**
 * When this answer stops being worth keeping: the earliest expiry among the
 * files the plugin plays from it, less the usual margin.
 */
export function infoExpiresAt(info: YtDlpInfo, now = Date.now()): number {
  const urls = [pickProgressive(info.formats ?? [])?.url, pickAudioUrl(info.formats ?? [])]
    .filter((u): u is string => !!u);
  if (!urls.length) return now; // nothing playable: not worth keeping
  return Math.min(...urls.map(parseExpiry)) - EXPIRY_SAFETY_MARGIN_MS;
}

function toStream(url: string, mode: ResolvedStream["mode"]): ResolvedStream {
  return {
    url,
    isHls: url.includes(".m3u8") || url.includes("/hls_playlist/") || url.includes("/manifest/hls"),
    mode,
    expiresAt: parseExpiry(url) - EXPIRY_SAFETY_MARGIN_MS,
  };
}

/** The first frame: the single file, or an HLS variant when there is none. */
export function fastStreamFromInfo(info: YtDlpInfo): ResolvedStream {
  const formats = info.formats ?? [];
  const url = pickProgressive(formats)?.url ?? pickHls(formats)?.url;
  if (!url) throw new ResolveError("yt-dlp offered no format a player can open");
  return toStream(url, "fast");
}

/** HD's last resort, when the stitched stream cannot be built: an HLS variant. */
export function hlsStreamFromInfo(info: YtDlpInfo): ResolvedStream | null {
  const url = pickHls(info.formats ?? [])?.url;
  return url ? toStream(url, "quality") : null;
}
