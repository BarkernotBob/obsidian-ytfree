/**
 * YouTube links open in Obsidian (GitHub #3, `docs/V1-SCOPE-URL-HANDOFF.md`).
 *
 * Which links count, which video and second they mean, and where a link sits
 * in a line of markdown. Pure, so every URL shape has a test; the opening lives
 * in `main.ts`. Nothing here may import `obsidian` or a Node builtin.
 */

import { extractVideoId } from "./stream.ts";

export interface YouTubeLink {
  videoId: string;
  /** Where to start, from `t=` / `start=` / `#t=`. 0 when the link has none. */
  seconds: number;
}

/** The action under `obsidian://`. */
export const HANDOFF_ACTION = "ytfree";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Parse a URL, tolerating a missing scheme ("youtu.be/…" pasted from a chat). */
function toUrl(input: string): URL | null {
  const text = input.trim();
  if (!text) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

export function isYouTubeUrl(input: string): boolean {
  const url = toUrl(input);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return false;
  return YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * "90", "90s", "1m30s", "1h2m3s", "1:30", "1:02:03" → seconds. 0 for anything
 * else: a start time that cannot be read is no start time, not an error.
 */
export function parseStartTime(raw: string | null | undefined): number {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  if (/^\d+(?::\d{1,2}){1,2}$/.test(text)) {
    return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }
  const units = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  return 0;
}

/**
 * The video and start second a YouTube link names, or null when it names no
 * video (a channel, a playlist on its own, the home page) or is not YouTube.
 */
export function parseYouTubeLink(input: string): YouTubeLink | null {
  if (!isYouTubeUrl(input)) return null;
  const url = toUrl(input);
  if (!url) return null;
  const videoId = extractVideoId(url.toString());
  if (!videoId) return null;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const seconds = parseStartTime(
    url.searchParams.get("t") ?? url.searchParams.get("start") ?? hash.get("t"),
  );
  return { videoId, seconds };
}

/** What the handler is reached by: `obsidian://ytfree?url=…`. */
export function handoffUri(youtubeUrl: string): string {
  return `obsidian://${HANDOFF_ACTION}?url=${encodeURIComponent(youtubeUrl)}`;
}

/**
 * A bookmark whose address is this sends the current tab to the handler. Works
 * in Safari, Chrome, Arc and Firefox with no extension.
 */
export const HANDOFF_BOOKMARKLET =
  "javascript:location.href='obsidian://ytfree?url='+encodeURIComponent(location.href)";

/**
 * The YouTube link under a character offset in one line of markdown, or null.
 *
 * Live Preview renders links as CodeMirror spans rather than anchors, so the
 * link has to be found in the text the same way Obsidian finds it: a markdown
 * link `[text](url)`, an autolink `<url>`, or a bare URL. Embeds (`![…](…)`)
 * are left alone — that is a picture or a player, not a link to follow.
 */
export function youTubeLinkAt(
  line: string,
  offset: number,
): { url: string; from: number; to: number } | null {
  const patterns = [
    /(!?)\[[^\]\n]*\]\(<?(https?:\/\/[^\s)>]+)>?\)/g,
    /()<(https?:\/\/[^\s>]+)>/g,
    /()(?<![(<\w])(https?:\/\/[^\s)<>\]]+)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const from = m.index;
      const to = m.index + m[0].length;
      if (offset < from || offset > to) continue;
      if (m[1] === "!") return null;
      return isYouTubeUrl(m[2]) ? { url: m[2], from, to } : null;
    }
  }
  return null;
}

