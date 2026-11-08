/**
 * What a kept answer is cut down to before it is stored on the device
 * (GitHub #34).
 *
 * A `yt-dlp -J` is 300–600 KB, most of it storyboards, caption tracks in
 * every language and format, and HTTP headers per format; a player response is
 * smaller but similar. `localStorage` holds about 5 MB, so only the fields the
 * plugin reads are stored. The in-memory answer is never trimmed.
 *
 * No `obsidian` import: tested directly.
 */
import type { YtDlpFormat } from "./adaptive.ts";
import type { YtDlpInfo } from "./ytdlp-info.ts";

const FORMAT_FIELDS: Array<keyof YtDlpFormat> = [
  "format_id", "url", "protocol", "ext", "vcodec", "acodec", "width", "height",
  "fps", "tbr", "language", "language_preference", "format_note",
];

type Tracks = Record<string, Array<{ ext?: string; url?: string }>>;

/** Only json3 tracks in the languages the transcript can ask for. */
function trimTracks(tracks: Tracks | undefined, languages: string[]): Tracks | undefined {
  if (!tracks) return undefined;
  const out: Tracks = {};
  for (const [lang, list] of Object.entries(tracks)) {
    if (!languages.some((want) => lang === want || lang.startsWith(`${want}-`))) continue;
    const json3 = (list ?? []).filter((t) => t.ext === "json3").map((t) => ({ ext: t.ext, url: t.url }));
    if (json3.length) out[lang] = json3;
  }
  return out;
}

/** A `yt-dlp -J` answer with only what the plugin reads. */
export function trimYtDlpInfo(info: YtDlpInfo, languages: string[] = ["en"]): YtDlpInfo {
  const formats = (info.formats ?? [])
    // Storyboards are images; nothing plays them.
    .filter((f) => f.format_note !== "storyboard" && !String(f.format_id ?? "").startsWith("sb"))
    .map((f) => {
      const kept: Record<string, unknown> = {};
      for (const field of FORMAT_FIELDS) if (f[field] !== undefined) kept[field] = f[field];
      return kept as YtDlpFormat;
    });
  return {
    formats,
    duration: info.duration,
    heatmap: info.heatmap,
    subtitles: trimTracks(info.subtitles, languages),
    automatic_captions: trimTracks(info.automatic_captions, languages),
  };
}

/** A player response with only what the plugin reads. */
export function trimPlayerAnswer(response: unknown): unknown {
  const r = (response ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const status = r.playabilityStatus;
  const streaming = r.streamingData;
  const details = r.videoDetails;
  return {
    playabilityStatus: status && { status: status.status, reason: status.reason },
    streamingData: streaming && {
      expiresInSeconds: streaming.expiresInSeconds,
      formats: streaming.formats,
      adaptiveFormats: streaming.adaptiveFormats,
      hlsManifestUrl: streaming.hlsManifestUrl,
    },
    videoDetails: details && {
      shortDescription: details.shortDescription,
      lengthSeconds: details.lengthSeconds,
      channelId: details.channelId,
      author: details.author,
      title: details.title,
    },
    captions: r.captions,
    microformat: r.microformat,
  };
}
