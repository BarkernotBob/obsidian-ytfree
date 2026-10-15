/**
 * HD without yt-dlp and without a download: YouTube's separate picture and
 * sound files, stitched into an HLS playlist that lives only in memory.
 *
 * Above 360p YouTube sends picture and sound as two files (issue 043, 005).
 * Each MP4 file starts with an index (`sidx`) that says where every few-second
 * chunk begins and how long it plays. Read the two indexes — one small
 * byte-range request each — and the chunks can be written down as an HLS VOD
 * playlist of `#EXT-X-BYTERANGE` segments, with the sound as an alternate audio
 * rendition. hls.js then plays it through MSE the same way it plays any HLS
 * stream: a few seconds ahead, seekable, nothing on disk. The bytes go through
 * an injected `fetchRange`, which is `requestUrl` in the app, so googlevideo's
 * missing CORS headers do not matter.
 *
 * Everything here is a pure function or takes its I/O as an argument, so the
 * tests run it under plain `node --test`. Nothing here may import `obsidian` or
 * a Node builtin.
 */

import { EXPIRY_SAFETY_MARGIN_MS, parseExpiry } from "./stream.ts";
import type { ResolvedStream, VirtualPlaylist } from "./stream.ts";

/** H.264 tops out here on YouTube, and it is plenty for a window or a phone. */
export const DEFAULT_MAX_HEIGHT = 1080;

/** The slice of an InnerTube `adaptiveFormats[]` entry this reads. */
export interface AdaptiveFormat {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  initRange?: { start?: string; end?: string };
  indexRange?: { start?: string; end?: string };
  contentLength?: string;
  approxDurationMs?: string;
}

export interface AdaptiveTrack {
  url: string;
  codecs: string;
  bitrate: number;
  width: number;
  height: number;
  /** Inclusive byte offsets, as YouTube states them. */
  init: { start: number; end: number };
  index: { start: number; end: number };
}

export interface AdaptivePair {
  video: AdaptiveTrack;
  audio: AdaptiveTrack;
}

/** One chunk of a file: where it is and how long it plays. */
export interface Segment {
  offset: number;
  length: number;
  duration: number;
}

function codecsOf(mimeType: string): string {
  return mimeType.match(/codecs="([^"]+)"/)?.[1] ?? "";
}

function range(r: { start?: string; end?: string } | undefined): { start: number; end: number } | null {
  if (!r) return null;
  const start = Number(r.start);
  const end = Number(r.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

function toTrack(f: AdaptiveFormat): AdaptiveTrack | null {
  const init = range(f.initRange);
  const index = range(f.indexRange);
  if (!f.url || !f.mimeType || !init || !index) return null;
  return {
    url: f.url,
    codecs: codecsOf(f.mimeType),
    bitrate: f.bitrate ?? 0,
    width: f.width ?? 0,
    height: f.height ?? 0,
    init,
    index,
  };
}

/**
 * The best H.264 picture at or below `maxHeight`, and the best AAC sound.
 *
 * MP4 only: WebM carries its index as Cues, not `sidx`, and VP9/AV1 cost
 * battery where H.264 is decoded in hardware. A format with no plain `url`
 * (a `signatureCipher` one) is skipped for the same reason as in
 * `pickMuxedFormat` — descrambling is the cost this path exists to avoid.
 */
export function pickPair(formats: AdaptiveFormat[], maxHeight = DEFAULT_MAX_HEIGHT): AdaptivePair | null {
  const videos = formats
    .filter((f) => f.mimeType?.startsWith("video/mp4") && codecsOf(f.mimeType).startsWith("avc1"))
    .filter((f) => (f.height ?? 0) > 0 && (f.height ?? 0) <= maxHeight)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const audios = formats
    .filter((f) => f.mimeType?.startsWith("audio/mp4") && codecsOf(f.mimeType).startsWith("mp4a"))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  const video = videos.map(toTrack).find((t) => t !== null) ?? null;
  const audio = audios.map(toTrack).find((t) => t !== null) ?? null;
  // Nothing above 360p is not worth a second player: the muxed stream already
  // plays at 360p.
  if (!video || !audio || video.height <= 360) return null;
  return { video, audio };
}

/**
 * Read an MP4 `sidx` box into segments.
 *
 * `bytes` are the file's `indexRange`, which starts at the box. Offsets in the
 * box count from the first byte after it, so `boxStart` is needed to turn
 * them into file offsets. Only a flat index is handled — YouTube's are flat,
 * and a nested one (reference_type 1) is refused rather than misread.
 */
export function parseSidx(bytes: ArrayBuffer, boxStart: number): Segment[] {
  const view = new DataView(bytes);
  let pos = 0;
  // Skip anything ahead of the sidx box, in case the range includes it.
  for (;;) {
    if (pos + 8 > view.byteLength) throw new Error("no sidx box in the index range");
    const size = view.getUint32(pos);
    const type = String.fromCharCode(
      view.getUint8(pos + 4), view.getUint8(pos + 5), view.getUint8(pos + 6), view.getUint8(pos + 7),
    );
    if (type === "sidx") break;
    if (size < 8) throw new Error("malformed box before sidx");
    pos += size;
  }

  const boxSize = view.getUint32(pos);
  const version = view.getUint8(pos + 8);
  let p = pos + 12; // size, type, version + flags
  p += 4; // reference_ID
  const timescale = view.getUint32(p);
  p += 4;
  let firstOffset: number;
  if (version === 0) {
    p += 4; // earliest_presentation_time
    firstOffset = view.getUint32(p);
    p += 4;
  } else {
    p += 8;
    firstOffset = Number(view.getBigUint64(p));
    p += 8;
  }
  p += 2; // reserved
  const count = view.getUint16(p);
  p += 2;
  if (!timescale) throw new Error("sidx has no timescale");
  if (p + count * 12 > view.byteLength) throw new Error("sidx is truncated");

  const segments: Segment[] = [];
  let offset = boxStart + pos + boxSize + firstOffset;
  for (let i = 0; i < count; i++, p += 12) {
    const ref = view.getUint32(p);
    if (ref >>> 31) throw new Error("nested sidx is not supported");
    const length = ref & 0x7fffffff;
    const duration = view.getUint32(p + 4) / timescale;
    segments.push({ offset, length, duration });
    offset += length;
  }
  if (!segments.length) throw new Error("sidx lists no segments");
  return segments;
}

/** Playlist URLs never reach the network: the loader answers them from memory. */
export function virtualBase(videoId: string): string {
  return `https://ytfree.invalid/${videoId}/`;
}

function mediaPlaylist(track: AdaptiveTrack, segments: Segment[]): string {
  const target = Math.ceil(Math.max(...segments.map((s) => s.duration)));
  const initLength = track.init.end - track.init.start + 1;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${target}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-MAP:URI="${track.url}",BYTERANGE="${initLength}@${track.init.start}"`,
  ];
  for (const s of segments) {
    lines.push(`#EXTINF:${s.duration.toFixed(6)},`, `#EXT-X-BYTERANGE:${s.length}@${s.offset}`, track.url);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

/** The master playlist and the two media playlists, keyed by their URLs. */
export function buildPlaylists(
  videoId: string,
  pair: AdaptivePair,
  videoSegments: Segment[],
  audioSegments: Segment[],
): { master: string; files: Record<string, string> } {
  const base = virtualBase(videoId);
  const master = `${base}master.m3u8`;
  const videoUrl = `${base}video.m3u8`;
  const audioUrl = `${base}audio.m3u8`;
  const { video, audio } = pair;
  const codecs = [video.codecs, audio.codecs].filter(Boolean).join(",");
  const masterText = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audioUrl}"`,
    `#EXT-X-STREAM-INF:BANDWIDTH=${video.bitrate + audio.bitrate},CODECS="${codecs}",` +
      `RESOLUTION=${video.width}x${video.height},AUDIO="a"`,
    videoUrl,
    "",
  ].join("\n");
  return {
    master,
    files: {
      [master]: masterText,
      [videoUrl]: mediaPlaylist(video, videoSegments),
      [audioUrl]: mediaPlaylist(audio, audioSegments),
    },
  };
}

/**
 * Fetch inclusive byte range `[start, end]` of a googlevideo URL. In the app
 * this is `requestUrl`; `ua` is the client identity the URL was issued to.
 */
export type FetchRange = (url: string, start: number, end: number, ua?: string) => Promise<ArrayBuffer>;

/**
 * Turn an adaptive pair into a playable stream: read both indexes (which is
 * also the proof that YouTube will serve these files), then build the
 * playlists. Throws when either file refuses or its index cannot be read.
 */
export async function streamFromPair(
  videoId: string,
  pair: AdaptivePair,
  fetchRange: FetchRange,
  ua?: string,
): Promise<ResolvedStream> {
  const [videoIndex, audioIndex] = await Promise.all([
    fetchRange(pair.video.url, pair.video.index.start, pair.video.index.end, ua),
    fetchRange(pair.audio.url, pair.audio.index.start, pair.audio.index.end, ua),
  ]);
  const videoSegments = parseSidx(videoIndex, pair.video.index.start);
  const audioSegments = parseSidx(audioIndex, pair.audio.index.start);
  const { master, files } = buildPlaylists(videoId, pair, videoSegments, audioSegments);

  const virtual: VirtualPlaylist = {
    files,
    fetchRange: (url, start, end) => fetchRange(url, start, end, ua),
  };
  const expiry = Math.min(parseExpiry(pair.video.url), parseExpiry(pair.audio.url));
  return {
    url: master,
    isHls: true,
    mode: "quality",
    expiresAt: expiry - EXPIRY_SAFETY_MARGIN_MS,
    virtual,
    height: pair.video.height,
  };
}

/** What one InnerTube client answered, reduced to what HD needs. */
export interface ClientAnswer {
  adaptiveFormats: AdaptiveFormat[];
  hlsManifestUrl: string | null;
  ua: string;
}

/**
 * The HD attempt order, shared by desktop and phone: each client's separate
 * pair, then any HLS manifest one of them offered. The first that serves bytes
 * wins. `ask` returning null means that client had nothing (not playable, or
 * the request failed); the next one is tried.
 */
export async function resolveHd(
  videoId: string,
  clients: string[],
  ask: (client: string) => Promise<ClientAnswer | null>,
  fetchRange: FetchRange,
  maxHeight = DEFAULT_MAX_HEIGHT,
): Promise<ResolvedStream> {
  const reasons: string[] = [];
  let hls: string | null = null;
  for (const client of clients) {
    const answer = await ask(client).catch(() => null);
    if (!answer) {
      reasons.push(`${client}: no answer`);
      continue;
    }
    hls ??= answer.hlsManifestUrl;
    const pair = pickPair(answer.adaptiveFormats, maxHeight);
    if (!pair) {
      reasons.push(`${client}: no HD pair`);
      continue;
    }
    try {
      return await streamFromPair(videoId, pair, fetchRange, answer.ua);
    } catch (err) {
      reasons.push(`${client}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (hls) {
    return {
      url: hls,
      isHls: true,
      mode: "quality",
      expiresAt: parseExpiry(hls) - EXPIRY_SAFETY_MARGIN_MS,
    };
  }
  throw new Error(`no HD stream (${reasons.join("; ")})`);
}

/** googlevideo takes a byte range as a query parameter as well as a header. */
export function withRange(url: string, start: number, end: number): string {
  const clean = url.replace(/([?&])range=[^&]*&?/, "$1").replace(/[?&]$/, "");
  return `${clean}${clean.includes("?") ? "&" : "?"}range=${start}-${end}`;
}
