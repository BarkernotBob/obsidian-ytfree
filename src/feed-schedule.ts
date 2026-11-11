/**
 * The order channel feeds are fetched in, and how per-channel check times
 * merge across devices (GitHub #66).
 *
 * Every poll fetches every channel, 5 at a time, stalest first. Rounds,
 * spacing and an hourly feed ceiling were built and then dropped on
 * 2026-11-09: `scripts/feed-torture.ts` sent 3,710 feed requests from Isaiah's
 * home IP (300 at once, 900 back to back, 1,800 over 30 minutes) with no
 * failure and no bot check, and he wants the Sync button to bring in every new
 * video. A shared IP (VPN, school) may differ; this is one home IP on one day.
 *
 * Pure: no `obsidian`, no clock.
 */

/** Duration look-ups one poll may make (one player call each). */
export const DURATIONS_PER_POLL = 5;

/**
 * Every channel, the ones checked longest ago first. A channel never checked
 * (no `polledAt`, as after an import) counts as oldest; ties keep list order.
 */
export function stalestFirst<T extends { polledAt?: string | null }>(channels: readonly T[]): T[] {
  const stamp = (channel: T): number => {
    const at = Date.parse(channel.polledAt ?? "");
    return Number.isFinite(at) ? at : -Infinity;
  };
  return channels
    .map((channel, index) => ({ channel, index, at: stamp(channel) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
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
