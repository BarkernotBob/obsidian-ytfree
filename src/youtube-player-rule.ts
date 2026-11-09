/**
 * When YouTube's own embedded player plays a video instead of our stream
 * (GitHub #66 item 7, built into the app by #43).
 *
 * Our stream is the default everywhere. YouTube's player is used only when:
 * - every stream tier this device has (yt-dlp on a desktop that has it, then
 *   our own stream) was tried for this video on this Play and failed, or
 * - YouTube answered a bot check on this network and the next retry is not
 *   due yet (`bot-check.ts`). A Play that is due tries our stream first.
 *
 * Never preemptively: not on a guess, not for an age-restricted video, not as
 * a setting. This file has no `obsidian` import so it is tested directly.
 */

export type StreamTier = "yt-dlp" | "own";

export interface PlayerRuleInput {
  /** The tiers this device has, in the order they are tried. */
  tiers: readonly StreamTier[];
  /** The tiers that were tried for this video on this Play and failed. */
  failed: ReadonlySet<StreamTier>;
  /** A bot-check pause is on (`botCheck.isPaused()`). */
  paused: boolean;
  /** A Play now would be the next retry (`botCheck.retryDue()`). */
  retryDue: boolean;
}

export type PlayerChoice =
  | { use: "stream"; tier: StreamTier }
  | { use: "youtube"; why: "all-tiers-failed" | "bot-check" };

/** Which player this Play gets, and the next stream tier to try if ours. */
export function choosePlayer(input: PlayerRuleInput): PlayerChoice {
  if (input.paused && !input.retryDue) return { use: "youtube", why: "bot-check" };
  const next = input.tiers.find((tier) => !input.failed.has(tier));
  if (next) return { use: "stream", tier: next };
  return { use: "youtube", why: "all-tiers-failed" };
}
