/**
 * Which stream tiers have failed for which video (GitHub #43 part 1).
 *
 * A tier fails when it cannot resolve a link, and also when the link it gave
 * will not play before it expires: yt-dlp can hand back a link YouTube then
 * refuses (an old yt-dlp, or a quirk of one video), and re-asking yt-dlp only
 * gets the same refusal. `choosePlayer` reads this set to pick the next tier.
 *
 * Kept per video for `FAILURE_TTL_MS`, so a video that failed this evening is
 * tried on yt-dlp again tomorrow. No `obsidian` import: tested directly.
 */

import { choosePlayer } from "./youtube-player-rule.ts";
import type { StreamTier } from "./youtube-player-rule.ts";

export const FAILURE_TTL_MS = 30 * 60_000;

export class TierFailures {
  private marks = new Map<string, Map<StreamTier, number>>();

  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  mark(videoId: string, tier: StreamTier): void {
    const tiers = this.marks.get(videoId) ?? new Map<StreamTier, number>();
    tiers.set(tier, this.now());
    this.marks.set(videoId, tiers);
  }

  failed(videoId: string): Set<StreamTier> {
    const out = new Set<StreamTier>();
    const tiers = this.marks.get(videoId);
    if (!tiers) return out;
    for (const [tier, at] of tiers) {
      if (this.now() - at < FAILURE_TTL_MS) out.add(tier);
      else tiers.delete(tier);
    }
    if (tiers.size === 0) this.marks.delete(videoId);
    return out;
  }

  clear(videoId: string): void {
    this.marks.delete(videoId);
  }
}

/**
 * Every stream tier has failed for this video. Until YouTube's own player is
 * built in (#43 part 2), the player shows this message and the error box
 * offers "Open in YouTube".
 */
export class AllTiersFailedError extends Error {
  constructor() {
    super("YouTube won't stream this video here right now. Try again later, or open it on YouTube.");
    this.name = "AllTiersFailedError";
  }
}

/**
 * Resolve 360p from the first tier that has not failed for this video, moving
 * down on each resolve failure. `stop` errors (a bot check) end the walk at
 * once: asking the next tier is more of what flagged the network.
 */
export async function resolveByTier<S>(opts: {
  videoId: string;
  tiers: () => StreamTier[];
  failures: TierFailures;
  resolve: (tier: StreamTier) => Promise<S>;
  /** Thrown on; the tier is not marked. */
  stop: (err: unknown) => boolean;
  /** Called on a failure; return false to not mark the tier (e.g. not installed). */
  onError?: (tier: StreamTier, err: unknown) => boolean;
}): Promise<S & { tier: StreamTier }> {
  let firstError: unknown = null;
  for (;;) {
    const choice = choosePlayer({
      tiers: opts.tiers(),
      failed: opts.failures.failed(opts.videoId),
      paused: false,
      retryDue: true,
    });
    if (choice.use === "youtube") {
      // The first failure's message is the one the error box knows how to explain.
      throw firstError instanceof Error ? firstError : new AllTiersFailedError();
    }
    try {
      return { ...(await opts.resolve(choice.tier)), tier: choice.tier };
    } catch (err) {
      if (opts.stop(err)) throw err;
      firstError ??= err;
      if (opts.onError?.(choice.tier, err) ?? true) opts.failures.mark(opts.videoId, choice.tier);
    }
  }
}
