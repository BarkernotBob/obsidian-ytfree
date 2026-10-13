/**
 * Filling the hole a rolled-over feed window leaves (issue 048).
 *
 * A channel's RSS feed is the last 15 uploads and nothing else. Stay away
 * longer than a channel takes to post 15 videos and the ones in between never
 * reach the hub, silently. This file decides when that has happened and which
 * videos fill the gap; the fetching lives in `hub.ts`, through 045's channel
 * `browse` call.
 *
 * Pure, so the rules have tests: when a gap is real, where a backfill stops,
 * and that nothing you deleted or hid can come back through it.
 */

import type { FeedEntry, HubItem } from "./subscriptions.ts";
import type { SearchResult } from "./search.ts";

/** The feed's whole window. A shorter feed is a channel with fewer uploads, not a roll. */
export const FEED_WINDOW = 15;

/**
 * How far back a backfill reaches when expiry is off.
 *
 * With expiry on, the horizon is the expiry setting: anything older would be
 * deleted on the next poll anyway. With it off (the default) a backfill still
 * needs an end, and a month is the gap it exists for — a holiday, a laptop
 * left shut, a sync wedged for weeks.
 */
export const DEFAULT_HORIZON_DAYS = 30;

/** Pages of a channel's Videos tab a backfill may read, at about 30 videos each. */
export const BACKFILL_MAX_PAGES = 5;

export function horizonDays(expiryDays: number): number {
  return expiryDays > 0 ? expiryDays : DEFAULT_HORIZON_DAYS;
}

/**
 * Did the window roll completely since this channel was last read?
 *
 * Exact in the negative: one feed entry the hub already knows — as an item in
 * any state, or as a deleted video — means the window overlaps what we had and
 * nothing was skipped. Positive only when all of these hold:
 *
 * - the feed is full (15). A channel with 9 uploads has nothing beyond them;
 * - the hub has met this channel before. A channel added a minute ago has no
 *   history to have a hole in;
 * - the oldest entry is inside the horizon. If it is not, the gap is older than
 *   anything the hub would keep, and there is nothing to fill.
 *
 * Called before the poll merges the feed, so "already known" means known before
 * this poll — afterwards every entry is known and no gap could ever be seen.
 */
export function feedWindowRolled(
  entries: ReadonlyArray<Pick<FeedEntry, "videoId" | "published">>,
  channelItems: ReadonlyArray<Pick<HubItem, "videoId">>,
  deleted: ReadonlyArray<{ id: string }>,
  now: Date,
  horizon: number,
): boolean {
  if (entries.length < FEED_WINDOW) return false;
  if (channelItems.length === 0) return false;
  const known = new Set(channelItems.map((item) => item.videoId));
  for (const entry of deleted) known.add(entry.id);
  if (entries.some((entry) => known.has(entry.videoId))) return false;
  const oldest = Math.min(...entries.map((entry) => Date.parse(entry.published)));
  if (!Number.isFinite(oldest)) return false;
  return oldest >= now.getTime() - horizon * 86_400_000;
}

const AGE_UNITS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
  year: 31_536_000,
};

/**
 * "3 weeks ago" → seconds, roughly. Used only to know when a backfill has
 * walked past its horizon — never stored, never shown: a date guessed from
 * that phrase is the fabrication the hub refuses to write into a note.
 * Null when the phrase is not an age ("Streamed live", a premiere).
 */
export function relativeAgeSeconds(text: string): number | null {
  const match = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return null;
  return Number(match[1]) * AGE_UNITS[match[2].toLowerCase()];
}

export interface BackfillWalk {
  /** Videos to add, newest first. */
  take: SearchResult[];
  /** True once the walk reached something known or the horizon: no more pages needed. */
  done: boolean;
}

/**
 * One page of a channel's Videos tab, walked newest to oldest.
 *
 * Stops at the first video the hub already knows — that is where the gap
 * closes — or the first one past the horizon. Videos the feed just delivered
 * are skipped rather than stopped at: they are the newest 15, which is the
 * top of the same list. Deleted videos count as known, so a video you deleted
 * cannot return this way; a hidden one is an item and counts too.
 */
export function walkBackfillPage(
  results: ReadonlyArray<SearchResult>,
  knownBefore: ReadonlySet<string>,
  justAdded: ReadonlySet<string>,
  horizon: number,
): BackfillWalk {
  const take: SearchResult[] = [];
  for (const result of results) {
    if (justAdded.has(result.videoId)) continue;
    if (knownBefore.has(result.videoId)) return { take, done: true };
    const age = relativeAgeSeconds(result.publishedText);
    if (age !== null && age > horizon * 86_400) return { take, done: true };
    take.push(result);
  }
  return { take, done: false };
}

/**
 * A backfilled video, as a hub item — the same shape a feed entry becomes in
 * `mergeItems`, so nothing downstream can tell the two apart. The publish date
 * comes from a player call (see `fetchPublishDate`); "" when YouTube would not
 * say, which reads as undated everywhere, exactly as a search item does.
 */
export function backfillItem(
  result: SearchResult,
  channel: { id: string; title: string },
  details: { published: string; description: string; durationSeconds: number | null },
  now: Date,
): HubItem {
  return {
    videoId: result.videoId,
    channelId: channel.id,
    channelTitle: channel.title,
    title: result.title,
    published: details.published,
    thumbnail: `https://i.ytimg.com/vi/${result.videoId}/mqdefault.jpg`,
    description: details.description,
    views: result.views,
    durationSeconds: details.durationSeconds,
    isShort: null,
    state: "new",
    seenAt: now.toISOString(),
    origin: "feed",
  };
}

/** "Ward on Words: 11 videos from Sep 2 to Sep 30 were missed by the feed and added." */
export function backfillMessage(channelTitle: string, items: ReadonlyArray<HubItem>): string {
  const dates = items
    .map((item) => Date.parse(item.published))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  const day = (time: number): string =>
    new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const noun = items.length === 1 ? "video" : "videos";
  const range =
    dates.length === 0
      ? ""
      : dates.length === 1 || day(dates[0]) === day(dates[dates.length - 1])
        ? ` from ${day(dates[0])}`
        : ` from ${day(dates[0])} to ${day(dates[dates.length - 1])}`;
  return `${channelTitle}: ${items.length} ${noun}${range} were missed by the feed and added to your Inbox.`;
}
