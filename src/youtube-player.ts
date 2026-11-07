/**
 * YouTube's own player on the phone (GitHub #25, part 2): the parts that need
 * no app — the hosted page's address and the messages it sends.
 *
 * Why a hosted page at all: framed straight from Obsidian iOS, the embed runs
 * under `capacitor://localhost`, gets no usable referrer and refuses to play
 * (error 153, issue 004). `docs/player/index.html`, served by GitHub Pages,
 * is a real https origin, and frames the player from there.
 */

export const PLAYER_PAGE = "https://barkernotbob.github.io/obsidian-ytfree/player/";
export const PLAYER_ORIGIN = new URL(PLAYER_PAGE).origin;

export function playerPageUrl(videoId: string, startSeconds: number, rate: number, base = PLAYER_PAGE): string {
  const url = new URL(base);
  url.searchParams.set("v", videoId);
  const t = Math.max(0, Math.floor(startSeconds));
  if (t > 0) url.searchParams.set("t", String(t));
  if (rate !== 1) url.searchParams.set("rate", String(rate));
  return url.href;
}

export interface PlayerStatus {
  type: "status";
  time: number;
  duration: number;
  /** YouTube's state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  state: number;
  rate: number;
  /** e.g. "hd1080", "hd720", "large"; empty when YouTube doesn't say. */
  quality: string;
}

export type PlayerMessage =
  | PlayerStatus
  | { type: "ready" }
  | { type: "error"; code: string | number };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A message from the page, or null for anything that isn't one. */
export function parsePlayerMessage(data: unknown): PlayerMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.source !== "ytfree-player") return null;
  switch (d.type) {
    case "ready":
      return { type: "ready" };
    case "error":
      return { type: "error", code: typeof d.code === "number" || typeof d.code === "string" ? d.code : "unknown" };
    case "status":
      return {
        type: "status",
        time: num(d.time),
        duration: num(d.duration),
        state: num(d.state),
        rate: num(d.rate) || 1,
        quality: typeof d.quality === "string" ? d.quality : "",
      };
    default:
      return null;
  }
}

/** YouTube's quality names, as heights. */
const HEIGHTS: Record<string, string> = {
  tiny: "144p",
  small: "240p",
  medium: "360p",
  large: "480p",
  hd720: "720p",
  hd1080: "1080p",
  hd1440: "1440p",
  hd2160: "2160p",
  highres: "4K+",
};

export function qualityLabel(quality: string): string {
  return HEIGHTS[quality] ?? (quality || "…");
}

/** YouTube's error codes, in words. */
export function playerErrorText(code: string | number): string {
  switch (code) {
    case 2:
      return "YouTube didn't accept this video ID.";
    case 5:
      return "YouTube's player couldn't play this video here.";
    case 100:
      return "The video is private or was removed.";
    case 101:
    case 150:
      return "The owner doesn't allow this video in other apps.";
    case 153:
      return "YouTube refused the page hosting its player (error 153).";
    default:
      return `YouTube's player failed (${code}).`;
  }
}
