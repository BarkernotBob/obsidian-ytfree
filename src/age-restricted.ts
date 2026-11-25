/**
 * Age-restricted videos are blocked everywhere (GitHub #111,
 * `docs/V1-SCOPE-AGE-RESTRICTED.md`).
 *
 * One place that knows what an age gate looks like, in every form it arrives:
 * an InnerTube player answer (`playabilityStatus`), a yt-dlp error, and a
 * yt-dlp info JSON. Everything that meets one throws `AgeRestrictedError`,
 * which the player shows as `AGE_BLOCKED_MESSAGE` with no way round it, and
 * reports the video so the hub can remember it in the synced `ageRestricted`
 * list and hide it from every list.
 *
 * No `obsidian` import and no Node builtin: tested directly, loaded on iOS.
 */

import { isBotCheckText } from "./bot-check.ts";

/** What Play, a download and a video note say for a blocked video. */
export const AGE_BLOCKED_MESSAGE = "Blocked: this video is age-restricted.";

/**
 * yt-dlp's `--age-limit`: refuse anything rated above 17, which on YouTube is
 * every age-gated (18+) video.
 */
export const YTDLP_AGE_LIMIT = 17;

/** How many blocked videos are remembered. Oldest falls off first. */
export const AGE_RESTRICTED_LIMIT = 1000;

/**
 * Statuses that are an age or content gate whatever the reason says. With
 * `contentCheckOk`/`racyCheckOk` false, a video behind a content warning
 * answers `CONTENT_CHECK_REQUIRED`; v1 treats that the same as an age gate.
 */
const GATE_STATUSES = new Set(["AGE_CHECK_REQUIRED", "AGE_VERIFICATION_REQUIRED", "CONTENT_CHECK_REQUIRED"]);

/**
 * The wording of an age gate, from InnerTube and yt-dlp alike: "Sign in to
 * confirm your age", "This video may be inappropriate for some users", "This
 * video is age-restricted", and yt-dlp's own "…because it is age restricted"
 * when `--age-limit` skips one. Members-only ("Join this channel…") and the
 * bot check ("confirm you're not a bot") match none of these.
 */
const AGE_TEXT = /confirm your age|\bage[- ]restricted|inappropriate for some users|\bage[- ]?gated\b/i;

/** Text that names an age gate (and is not the bot check). */
export function isAgeGateText(text: string): boolean {
  return AGE_TEXT.test(text) && !isBotCheckText(text);
}

/** A player answer's `playabilityStatus` that is an age or content gate. */
export function isAgeGatePlayability(status: unknown, reason: unknown): boolean {
  if (typeof status !== "string" || status === "OK") return false;
  if (GATE_STATUSES.has(status)) return true;
  return typeof reason === "string" && isAgeGateText(reason);
}

/** A whole player answer that is an age or content gate. */
export function isAgeGatedAnswer(response: unknown): boolean {
  const status = (response as { playabilityStatus?: { status?: unknown; reason?: unknown } } | null)
    ?.playabilityStatus;
  return Boolean(status) && isAgeGatePlayability(status?.status, status?.reason);
}

/** yt-dlp's `age_limit` on a video it did return: 18 is YouTube's age gate. */
export function isAdultAgeLimit(ageLimit: unknown): boolean {
  return typeof ageLimit === "number" && ageLimit > YTDLP_AGE_LIMIT;
}

/** Thrown wherever a video turns out to be age-restricted. Never retried. */
export class AgeRestrictedError extends Error {
  readonly videoId: string;

  constructor(videoId: string) {
    super(AGE_BLOCKED_MESSAGE);
    this.name = "AgeRestrictedError";
    this.videoId = videoId;
  }
}

/**
 * Any error that means "age-restricted": ours, a mobile resolve failure of
 * that kind, or an error whose text names an age gate (a yt-dlp stderr). By
 * name and kind rather than `instanceof`, so a copy from another bundle chunk
 * still counts.
 */
export function isAgeRestricted(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { name?: unknown; kind?: unknown; message?: unknown };
  if (e.name === "AgeRestrictedError" || e.kind === "age-restricted") return true;
  const text = typeof e.message === "string" ? e.message : typeof err === "string" ? err : "";
  return isAgeGateText(text);
}

/**
 * Where a found age gate goes. The hub sets this once it loads; until then a
 * report is dropped (the video still refuses to play, it is only not
 * remembered yet).
 */
let listener: ((videoId: string) => void) | null = null;

export function onAgeRestricted(fn: ((videoId: string) => void) | null): void {
  listener = fn;
}

export function reportAgeRestricted(videoId: string): void {
  if (!videoId) return;
  try {
    listener?.(videoId);
  } catch (err) {
    console.error("YouTube for You: could not record an age-restricted video.", err);
  }
}
