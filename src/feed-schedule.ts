/**
 * When channel feeds are fetched, and how many at a time (GitHub #66).
 *
 * A Takeout import of hundreds of channels used to mean hundreds of feed
 * requests in one burst, every poll. Feeds are not capped by the request
 * governor (they are the hub's whole job), so the schedule itself is the cap:
 *
 * - **Rounds, not passes.** The channel list is cut into slices of at most
 *   `ROUND_MAX_CHANNELS`. Each poll is one round and fetches the slice whose
 *   channels were checked longest ago (`Channel.polledAt`), so every channel is
 *   still checked once per period, just not all at the same moment.
 * - **The period stretches with the list.** Never more than `FEEDS_PER_HOUR`
 *   feeds an hour on average: 120 channels keep the configured period, 600 are
 *   each checked every five hours.
 * - **Jitter.** Feeds inside a round are fetched one at a time with a random
 *   gap, and the gap between rounds is lengthened by up to 2 × `ROUND_JITTER`,
 *   so the traffic does not look like a clock.
 *
 * Pure: no `obsidian`, no clock, no randomness of its own. Callers pass `now`
 * and a `random()` so the tests can pin both.
 */

/** Average feed requests an hour the schedule never exceeds. */
export const FEEDS_PER_HOUR = 120;

/** The most channels one round fetches. */
export const ROUND_MAX_CHANNELS = 25;

/** Shortest gap between two rounds, whatever the settings say. */
export const MIN_ROUND_MS = 5 * 60_000;

/**
 * Round intervals are lengthened by a random factor in [1, 1 + 2 × this].
 * Only ever longer: the un-jittered interval already sits at the
 * `FEEDS_PER_HOUR` ceiling, so a shorter gap would break it.
 */
export const ROUND_JITTER = 0.15;

/** Gap between two feeds inside a round: this, plus up to `FEED_GAP_SPREAD_MS`. */
export const FEED_GAP_MIN_MS = 400;
export const FEED_GAP_SPREAD_MS = 1600;

/**
 * Player calls for missing durations per pass over a short list. A long list
 * spreads these over its rounds but still makes at least one a round, so its
 * pass makes up to `roundsPerPeriod` of them.
 */
export const DURATIONS_PER_PERIOD = 5;

/**
 * How long it takes to check every channel once. The configured period
 * (never under five minutes), stretched so that the whole list costs at most
 * `FEEDS_PER_HOUR` feeds an hour.
 */
export function pollPeriodMs(settingMinutes: number, channelCount: number): number {
  const configured = Math.max(5, settingMinutes) * 60_000;
  const byVolume = (channelCount / FEEDS_PER_HOUR) * 3_600_000;
  return Math.max(configured, byVolume);
}

/** How many rounds one period is cut into. One for a short list. */
export function roundsPerPeriod(channelCount: number): number {
  return Math.max(1, Math.ceil(channelCount / ROUND_MAX_CHANNELS));
}

/** How many channels a round fetches. All of them for a short list. */
export function roundSize(channelCount: number): number {
  if (channelCount <= 0) return 0;
  return Math.ceil(channelCount / roundsPerPeriod(channelCount));
}

/**
 * Gap between two automatic rounds, before jitter. Equal to the configured
 * period for a list of up to `ROUND_MAX_CHANNELS` channels — nothing changes
 * for anyone with a short list.
 */
export function roundIntervalMs(settingMinutes: number, channelCount: number): number {
  const interval = pollPeriodMs(settingMinutes, channelCount) / roundsPerPeriod(channelCount);
  return Math.max(MIN_ROUND_MS, interval);
}

/** `roundIntervalMs`, lengthened by a jitter factor drawn from `random()` ∈ [0, 1). */
export function jitteredRoundMs(
  settingMinutes: number,
  channelCount: number,
  random: () => number,
): number {
  const factor = 1 + 2 * ROUND_JITTER * random();
  return Math.max(MIN_ROUND_MS, Math.round(roundIntervalMs(settingMinutes, channelCount) * factor));
}

/** The random pause before the next feed in a round. */
export function feedGapMs(random: () => number): number {
  return FEED_GAP_MIN_MS + Math.floor(FEED_GAP_SPREAD_MS * random());
}

/** Duration look-ups one round may make: the per-period budget spread over the rounds. */
export function durationsPerRound(channelCount: number): number {
  return Math.max(1, Math.ceil(DURATIONS_PER_PERIOD / roundsPerPeriod(channelCount)));
}

/**
 * The channels this round fetches: the `roundSize` checked longest ago. A
 * channel never checked (no `polledAt`, as after an import) counts as oldest;
 * ties keep list order, so an import is walked top to bottom.
 */
export function pickRound<T extends { polledAt?: string | null }>(channels: readonly T[]): T[] {
  const size = roundSize(channels.length);
  const stamp = (channel: T): number => {
    const at = Date.parse(channel.polledAt ?? "");
    return Number.isFinite(at) ? at : -Infinity;
  };
  return channels
    .map((channel, index) => ({ channel, index, at: stamp(channel) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .slice(0, size)
    .map((entry) => entry.channel);
}

/** The later of two `polledAt` stamps, for merging two devices' copies. */
export function laterStamp(
  a: string | null | undefined,
  b: string | null | undefined,
): string | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return a > b ? a : b;
}
