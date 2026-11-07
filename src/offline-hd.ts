/**
 * The offline HD player's manifest (GitHub #38): a folder of local files that
 * stands in for one YouTube video, so the HD badge, buffering, scrubbing, the
 * quality switch and Start in HD can be tried in Obsidian with no request to
 * YouTube at all.
 *
 * `node tools/make-offline-hd.mjs <any video> <folder>` writes the folder:
 * fragmented MP4s with a `sidx` up front (the layout YouTube serves), one per
 * height, an M4A for the sound, a 360p single file, and `offline.json`
 * describing them. Turned on by `"devOfflineHd": "<folder>"` in the plugin's
 * `data.json`; there is no switch in the settings tab.
 *
 * No `obsidian` or Node import: tested directly.
 */
import type { YtDlpFormat } from "./adaptive.ts";

export interface OfflineManifest {
  /** The single file the first frame plays, relative to the folder. */
  progressive: string;
  videos: Array<{ file: string; width: number; height: number; codecs: string; kbps: number }>;
  audio: { file: string; codecs: string; kbps: number };
}

/** Where a file lives in the offline player's address space. */
export const OFFLINE_HOST = "https://offline-hd.invalid/";

export function offlineUrl(file: string): string {
  return OFFLINE_HOST + encodeURIComponent(file);
}

/** The file an offline URL names, or null for any other URL. */
export function offlineFile(url: string): string | null {
  if (!url.startsWith(OFFLINE_HOST)) return null;
  const name = decodeURIComponent(url.slice(OFFLINE_HOST.length).split("?")[0]);
  // Never outside the folder.
  return name && !name.includes("/") && !name.includes("\\") && name !== ".." ? name : null;
}

/** A manifest from `offline.json`, or null when it is not one. */
export function parseOfflineManifest(text: string): OfflineManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const m = raw as Partial<OfflineManifest>;
  if (typeof m?.progressive !== "string" || !Array.isArray(m.videos) || !m.audio) return null;
  const videos = m.videos.filter(
    (v) => typeof v?.file === "string" && typeof v.height === "number" && typeof v.codecs === "string",
  );
  if (!videos.length || typeof m.audio.file !== "string" || typeof m.audio.codecs !== "string") return null;
  return { progressive: m.progressive, videos, audio: m.audio };
}

/** The manifest as yt-dlp would have described those files, for `resolveHdFromYtDlp`. */
export function offlineFormats(m: OfflineManifest): YtDlpFormat[] {
  return [
    ...m.videos.map((v, i) => ({
      format_id: String(9000 + i),
      url: offlineUrl(v.file),
      protocol: "https",
      ext: "mp4",
      vcodec: v.codecs,
      acodec: "none",
      width: v.width,
      height: v.height,
      fps: 30,
      tbr: v.kbps,
    })),
    {
      format_id: "9900",
      url: offlineUrl(m.audio.file),
      protocol: "https",
      ext: "m4a",
      vcodec: "none",
      acodec: m.audio.codecs,
      tbr: m.audio.kbps,
      language_preference: 10,
    },
  ];
}
