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
  /**
   * Present when a video has more than one sound track — YouTube's automatic
   * dubs. Each language is a separate format with the same itag, and the dubs
   * can outrank the original on bitrate.
   */
  audioTrack?: { id?: string; displayName?: string; audioIsDefault?: boolean };
  /** `acont=original` / `acont=dubbed-auto` live in here as well. */
  xtags?: string;
}

export interface AdaptiveTrack {
  /** Which file this is. A fresh answer names the same file by the same itag. */
  itag: number;
  /** The sound track's language id, when the video has more than one. */
  audioTrackId?: string;
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
  /** The top rung of `ladder`. */
  video: AdaptiveTrack;
  /**
   * One picture per height, highest first, down to 240p. hls.js switches
   * between them: a jump lands on a low rung so it plays at once, then climbs
   * back to `video` (Isaiah, 2026-10-15: "a quick buffer at lower res").
   */
  ladder: AdaptiveTrack[];
  audio: AdaptiveTrack;
}

/** The lowest rung worth offering. Below this a jump looks broken, not fast. */
export const MIN_LADDER_HEIGHT = 240;

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
    itag: f.itag ?? 0,
    ...(f.audioTrack?.id ? { audioTrackId: f.audioTrack.id } : {}),
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
 * Which sound track to prefer, highest first: the one YouTube plays by
 * default, then one marked original, then a format with no track info (a
 * single-language video), and a dub last. Picking by bitrate alone handed
 * Isaiah a dubbed track on 2026-10-15.
 */
export function audioRank(f: AdaptiveFormat): number {
  const track = f.audioTrack;
  const tags = `${f.xtags ?? ""} ${track?.displayName ?? ""} ${track?.id ?? ""}`.toLowerCase();
  if (track?.audioIsDefault) return 3;
  if (tags.includes("original")) return 2;
  if (!track && !tags.includes("dubbed")) return 1;
  return 0;
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
    .sort((a, b) => audioRank(b) - audioRank(a) || (b.bitrate ?? 0) - (a.bitrate ?? 0));

  const ladder: AdaptiveTrack[] = [];
  for (const f of videos) {
    const track = toTrack(f);
    if (!track || track.height < MIN_LADDER_HEIGHT) continue;
    // Sorted best-first, so the first track at each height is the one to keep.
    if (ladder.some((t) => t.height === track.height)) continue;
    ladder.push(track);
  }
  const audio = audios.map(toTrack).find((t) => t !== null) ?? null;
  const video = ladder[0] ?? null;
  // Nothing above 360p is not worth a second player: the muxed stream already
  // plays at 360p.
  if (!video || !audio || video.height <= 360) return null;
  return { video, ladder, audio };
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

export interface Rung {
  track: AdaptiveTrack;
  segments: Segment[];
}

/** The master playlist and every media playlist, keyed by their URLs. */
export function buildPlaylists(
  videoId: string,
  videos: Rung[],
  audio: Rung,
): { master: string; files: Record<string, string> } {
  const base = virtualBase(videoId);
  const master = `${base}master.m3u8`;
  const audioUrl = `${base}audio.m3u8`;
  const files: Record<string, string> = { [audioUrl]: mediaPlaylist(audio.track, audio.segments) };
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audioUrl}"`,
  ];
  // Lowest first: hls.js numbers levels in manifest order, and the player
  // drops to level 0 for a jump.
  for (const { track, segments } of [...videos].sort((x, y) => x.track.height - y.track.height)) {
    const url = `${base}video-${track.height}.m3u8`;
    const codecs = [track.codecs, audio.track.codecs].filter(Boolean).join(",");
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${track.bitrate + audio.track.bitrate},CODECS="${codecs}",` +
        `RESOLUTION=${track.width}x${track.height},AUDIO="a"`,
      url,
    );
    files[url] = mediaPlaylist(track, segments);
  }
  lines.push("");
  files[master] = lines.join("\n");
  return { master, files };
}

/**
 * Fetch inclusive byte range `[start, end]` of a googlevideo URL. In the app
 * this is `requestUrl`; `ua` is the client identity the URL was issued to.
 */
export type FetchRange = (url: string, start: number, end: number, ua?: string) => Promise<ArrayBuffer>;

/**
 * How far into a file the resolve looks before trusting it.
 *
 * YouTube can serve the opening of a file and refuse the rest: NewPipe saw
 * 403s at 1:09 on stream URLs issued without an anti-bot token. Under a 30 s
 * buffer that is a stall at about 55 s, then a fall back to 360p with
 * different sound (Isaiah, 2026-10-22: "at right about 55 seconds, almost
 * every video pauses"). A small read from past that point at resolve time
 * finds out while 360p is still playing, and the next client gets a turn.
 */
export const DEEP_CHECK_SECONDS = 90;
const DEEP_CHECK_BYTES = 1024;

/** The segment that starts at or past `seconds`, or the last one. */
export function segmentAt(segments: Segment[], seconds: number): Segment {
  let clock = 0;
  for (const s of segments) {
    if (clock >= seconds) return s;
    clock += s.duration;
  }
  return segments[segments.length - 1];
}

async function deepCheck(rung: Rung, fetchRange: FetchRange, ua?: string): Promise<void> {
  const s = segmentAt(rung.segments, DEEP_CHECK_SECONDS);
  try {
    await fetchRange(rung.track.url, s.offset, s.offset + Math.min(s.length, DEEP_CHECK_BYTES) - 1, ua);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`serves only the opening (${why})`);
  }
}

/** Another client's answer, asked for when a link stops working mid-play. */
export interface Reask {
  clients: string[];
  ask: (client: string) => Promise<ClientAnswer | null>;
}

/** A refusal, as opposed to a dropped connection: a fresh link may cure it. */
function isRefusal(err: unknown): boolean {
  const status = (err as { status?: number })?.status ?? 0;
  if (status === 403 || status === 404 || status === 410) return true;
  return /HTTP (403|404|410)\b/.test(err instanceof Error ? err.message : String(err));
}

/** The same files in a fresh answer, keyed by the URLs the playlists name. */
function matchTracks(tracks: AdaptiveTrack[], formats: AdaptiveFormat[]): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const t of tracks) {
    const f = formats.find((x) => x.itag === t.itag && x.url && (x.audioTrack?.id ?? undefined) === t.audioTrackId);
    if (!f?.url) return null;
    out.set(t.url, f.url);
  }
  return out;
}

/**
 * Byte ranges for the playlists' URLs, re-linked when YouTube stops honouring
 * them.
 *
 * The playlists keep naming the URLs they were built with; this keeps a map
 * from each to the link that currently works. On a refusal it asks the clients
 * again for the same files (same itag, so every offset still holds), takes the
 * first answer that serves the failed range, and re-links every track to it.
 * hls.js sees one slow segment instead of an error, so there is no fall back
 * to 360p and no retry ladder (which is also what made a jump slow). When no
 * client serves it, the refusal goes through and the player falls back as
 * before, and later refusals skip the asking.
 */
export function relinkingFetch(
  tracks: AdaptiveTrack[],
  fetchRange: FetchRange,
  ua?: string,
  reask?: Reask,
): (url: string, start: number, end: number) => Promise<ArrayBuffer> {
  const links = new Map<string, { url: string; ua?: string }>();
  let relinking: Promise<boolean> | null = null;
  let dead = false;

  const current = (url: string) => links.get(url) ?? { url, ua };

  const relink = async (url: string, start: number, end: number): Promise<ArrayBuffer | null> => {
    for (const client of reask!.clients) {
      const answer = await reask!.ask(client).catch(() => null);
      const fresh = answer && matchTracks(tracks, answer.adaptiveFormats);
      if (!answer || !fresh) continue;
      try {
        const bytes = await fetchRange(fresh.get(url) ?? url, start, end, answer.ua);
        for (const [from, to] of fresh) links.set(from, { url: to, ua: answer.ua });
        return bytes;
      } catch {
        // This client is refused at this point too; try the next one.
      }
    }
    return null;
  };

  return async (url, start, end) => {
    const link = current(url);
    try {
      return await fetchRange(link.url, start, end, link.ua);
    } catch (err) {
      if (!reask || dead || !isRefusal(err)) throw err;
      // Video and sound tend to be refused together: one re-link serves both.
      if (relinking) {
        await relinking;
        if (dead) throw err;
        const again = current(url);
        if (again.url === link.url) throw err;
        return fetchRange(again.url, start, end, again.ua);
      }
      let bytes: ArrayBuffer | null = null;
      relinking = relink(url, start, end).then((b) => ((bytes = b), b !== null));
      const ok = await relinking;
      relinking = null;
      if (!ok) {
        dead = true;
        throw err;
      }
      return bytes!;
    }
  };
}

/**
 * Turn an adaptive pair into a playable stream: read both indexes (which is
 * also the proof that YouTube will serve these files), check that the top rung
 * and the sound still serve past the first minute, then build the playlists.
 * Throws when either file refuses or its index cannot be read. `reask` lets the
 * stream re-link itself if YouTube refuses its links later.
 */
export async function streamFromPair(
  videoId: string,
  pair: AdaptivePair,
  fetchRange: FetchRange,
  ua?: string,
  reask?: Reask,
): Promise<ResolvedStream> {
  const read = async (track: AdaptiveTrack): Promise<Rung> => ({
    track,
    segments: parseSidx(await fetchRange(track.url, track.index.start, track.index.end, ua), track.index.start),
  });
  // The top rung and the sound must work: they are the point. A lower rung
  // that will not answer is only left off the ladder.
  const [top, audio, ...lower] = await Promise.all([
    read(pair.video),
    read(pair.audio),
    ...pair.ladder.slice(1).map((t) => read(t).catch(() => null)),
  ]);
  await Promise.all([deepCheck(top, fetchRange, ua), deepCheck(audio, fetchRange, ua)]);
  const videos = [top, ...lower.filter((r): r is Rung => r !== null)];
  const { master, files } = buildPlaylists(videoId, videos, audio);

  const virtual: VirtualPlaylist = {
    files,
    fetchRange: relinkingFetch([...videos.map((r) => r.track), audio.track], fetchRange, ua, reask),
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
      return await streamFromPair(videoId, pair, fetchRange, answer.ua, { clients, ask });
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
