/**
 * What the quality badge says, and the two small rules behind "Start in HD".
 *
 * Pure, so it loads under `node --test`: the player owns the element and the
 * hls.js events, this file owns the words.
 */

/** How long "Start in HD" waits for the HD resolve before playing 360p. */
export const HD_WAIT_MS = 15_000;

/**
 * Where HD has got to for one player.
 *
 * - `off`: HD was not asked for (the setting is off, or a local file).
 * - `finding`: the HD resolve is running; `height` is what plays meanwhile.
 * - `none`: HD is not coming for this video right now; `reason` says why.
 * - `climbing`: HD is attached and playing below its top rung.
 * - `top`: HD is playing its top rung.
 */
export type HdPhase = "off" | "finding" | "none" | "climbing" | "top";

export interface HdState {
  phase: HdPhase;
  /** The picture height playing now, when known. */
  height?: number;
  /** The highest rung the HD stream offers. */
  top?: number;
  reason?: string;
}

export interface BadgeText {
  text: string;
  /** The hover text: the longer version, for a badge that is short on purpose. */
  title: string;
  /** Nothing is still happening, so the badge can fade after a moment. */
  settled: boolean;
}

/** 360p when unknown: both "fast" paths (yt-dlp android_vr, InnerTube) are. */
const SD = 360;

const p = (height: number | undefined): string => `${height ?? SD}p`;

export function badgeText(state: HdState): BadgeText {
  switch (state.phase) {
    case "finding":
      return {
        text: `${p(state.height)} · finding HD…`,
        title: "Looking up the HD stream. The picture sharpens when it arrives.",
        settled: false,
      };
    case "climbing":
      return {
        text: `${p(state.height)} · HD loading`,
        title: `HD is playing and stepping up to ${p(state.top)} as the connection allows.`,
        settled: false,
      };
    case "top":
      return { text: p(state.height ?? state.top), title: "Full quality for this video.", settled: true };
    case "none":
      return {
        text: p(state.height),
        title: state.reason ? `No HD for this video right now (${state.reason}).` : "No HD for this video right now.",
        settled: true,
      };
    case "off":
    default:
      return { text: p(state.height), title: "HD is off in Settings → YT Free.", settled: true };
  }
}

/** The phase that a rung switch means, given the stream's top rung. */
export function rungPhase(height: number, top: number): HdPhase {
  return height >= top ? "top" : "climbing";
}

/** `promise`, or null if it has not settled within `ms`. A rejection is null too. */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * The end of the loaded stretch that `t` sits in, in seconds, or `t` itself
 * when nothing around it has loaded. What the progress line shades.
 */
export function bufferedAhead(ranges: { length: number; start(i: number): number; end(i: number): number }, t: number): number {
  for (let i = 0; i < ranges.length; i++) {
    // A hair of slack: the playhead sits a frame before a range it is about
    // to enter after a seek.
    if (t >= ranges.start(i) - 0.25 && t <= ranges.end(i)) return ranges.end(i);
  }
  return t;
}
