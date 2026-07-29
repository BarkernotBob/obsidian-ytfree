/**
 * The subscriptions hub — everything in it that does not need Obsidian.
 *
 * Feed parsing, the Takeout CSV, the merge rules, expiry, and the shape of the
 * note a click produces all live here so they can be tested without an app. The
 * view and the polling schedule live in `hub.ts` and `main.ts`.
 *
 * The one fact this whole design is bent around: a channel feed is a rolling
 * window of exactly 15 entries with no backfill. Anything older than that is
 * gone forever, which is why descriptions are cached at poll time rather than
 * fetched when a note is finally created.
 */

import { linkifyTimestamps } from "./description.ts";
import { DESCRIPTION_HEADING, NOTES_HEADING } from "./sections.ts";
import type { SearchResult } from "./search.ts";

/** A channel we poll. */
export interface Channel {
  /** `UC…` — the only durable identifier YouTube exposes. Handles get renamed. */
  id: string;
  title: string;
  /** ISO time this channel was added, so the hub can sort a fresh import. */
  addedAt: string;
  /** Message from the last failed poll, or null. Kept so the hub can show it. */
  error?: string | null;
}

/** New → clicked (Kept) or skipped (Dismissed). Only New expires. */
export type ItemState = "new" | "kept" | "dismissed";

/** One video in the hub. */
export interface HubItem {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  /** ISO publish time, from the feed. Expiry is measured from this. */
  published: string;
  thumbnail: string;
  /**
   * The full description, captured at poll time. This is the whole reason the
   * hub exists rather than an RSS reader: by the time you click, the video may
   * have fallen out of the 15-entry window and the description with it.
   */
  description: string;
  views: number | null;
  /**
   * How long the video runs, in seconds.
   *
   * A channel feed carries no duration at all, so this is `undefined` on
   * everything written before the phone card started showing one and stays
   * `undefined` until a poll backfills it (see `backfillDurations` in
   * `hub.ts`). `null` means "asked, and YouTube would not say" — a private or
   * removed video — which is a different fact from "not asked yet" and stops
   * the backfill retrying it forever.
   */
  durationSeconds?: number | null;
  /** null until the Shorts probe has run. */
  isShort: boolean | null;
  state: ItemState;
  /** ISO time this item first appeared in the hub. */
  seenAt: string;
  /** Vault path of the note a click created, if it still points anywhere. */
  notePath?: string;
  /**
   * Where it came from. Absent on everything written before the account import
   * existed, which is read as "feed" — the only source there was.
   */
  origin?: ItemOrigin;
  /** Seen on another device, per the account's watch history. Never written to. */
  watched?: boolean;
  /**
   * ISO time this item was hidden, set only on a Dismissed item.
   *
   * It is what the Hidden list sorts by — a hidden video's publish date is
   * beside the point, "the one I just removed" is what you are looking for —
   * and it is what decides which tombstone falls off the end of the cap.
   */
  dismissedAt?: string;
}

/** A channel feed, your Watch Later list, both, or a search you ran. */
export type ItemOrigin = "feed" | "watchlater" | "both" | "search";

export interface SubscriptionsState {
  version: 1;
  channels: Channel[];
  items: HubItem[];
  lastPolledAt: string | null;
}

export function emptyState(): SubscriptionsState {
  return { version: 1, channels: [], items: [], lastPolledAt: null };
}

/**
 * Tolerate anything on disk. A corrupt or half-written state file must degrade
 * to an empty hub, never to a plugin that fails to load.
 */
export function normalizeState(raw: unknown): SubscriptionsState {
  const state = emptyState();
  if (!raw || typeof raw !== "object") return state;
  const data = raw as Partial<SubscriptionsState>;
  if (Array.isArray(data.channels)) {
    state.channels = data.channels.filter(
      (c): c is Channel => Boolean(c) && typeof c.id === "string" && CHANNEL_ID_RE.test(c.id),
    );
  }
  if (Array.isArray(data.items)) {
    state.items = data.items.filter(
      (i): i is HubItem => Boolean(i) && typeof i.videoId === "string" && i.videoId.length === 11,
    );
  }
  state.lastPolledAt = typeof data.lastPolledAt === "string" ? data.lastPolledAt : null;
  return state;
}

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

export function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

export function shortsProbeUrl(videoId: string): string {
  return `https://www.youtube.com/shorts/${videoId}`;
}

// The probe itself needs Node's `https` (it has to see a redirect status, which
// `requestUrl` swallows), so it lives in `desktop/shorts-probe.ts`. This file
// stays platform-neutral and keeps only the URL it asks for.

/**
 * A channel ID out of whatever the user pasted: a bare `UC…`, a `/channel/UC…`
 * URL, or any URL containing one.
 *
 * A `@handle` URL carries no ID at all and cannot be resolved without fetching
 * the page — `extractChannelIdFromHtml` handles that half, from the caller.
 */
export function parseChannelInput(input: string): string | null {
  const text = input.trim();
  if (CHANNEL_ID_RE.test(text)) return text;
  const match = text.match(/(UC[A-Za-z0-9_-]{22})/);
  return match ? match[1] : null;
}

/** The channel ID embedded in a channel page, for `@handle` and `/c/` URLs. */
export function extractChannelIdFromHtml(html: string): string | null {
  const match =
    html.match(/"(?:externalId|channelId)":"(UC[A-Za-z0-9_-]{22})"/) ??
    html.match(/channel_id=(UC[A-Za-z0-9_-]{22})/);
  return match ? match[1] : null;
}

// ------------------------------------------------------------------- takeout

export interface ImportedChannel {
  id: string;
  title: string;
}

/**
 * Split one CSV line, honouring quoted fields and doubled quotes inside them.
 * Channel titles routinely contain commas, which is the only reason this is not
 * `line.split(",")`.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/**
 * Google Takeout's `subscriptions.csv`.
 *
 * The header is matched by name rather than by position, because the column
 * order is not something we control or were able to verify before building.
 * When the header is unrecognisable the parser falls back to "an ID somewhere
 * in the row", which is enough: the ID has a distinctive shape and the title is
 * cosmetic until the first poll replaces it with the feed's own.
 */
export function parseSubscriptionsCsv(text: string): ImportedChannel[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idColumn = header.findIndex((h) => h.includes("channel") && h.includes("id"));
  const titleColumn = header.findIndex((h) => h.includes("channel") && h.includes("title"));
  const hasHeader = idColumn >= 0;

  const seen = new Set<string>();
  const channels: ImportedChannel[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const fields = splitCsvLine(line);
    const rawId = idColumn >= 0 ? fields[idColumn] ?? "" : "";
    const id = parseChannelInput(rawId) ?? parseChannelInput(line);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = (titleColumn >= 0 ? fields[titleColumn] : "") || id;
    channels.push({ id, title });
  }
  return channels;
}

/**
 * Additive and idempotent. Re-importing a newer Takeout export adds what is new
 * and changes nothing else — in particular it never removes a channel that has
 * since been unsubscribed on YouTube. Unsubscribing there is not a statement
 * about what you want to keep seeing here; removing a channel is a deliberate
 * act in the hub.
 */
export function mergeChannels(
  existing: Channel[],
  incoming: ImportedChannel[],
  now: Date,
): { channels: Channel[]; added: number } {
  const byId = new Map(existing.map((c) => [c.id, c]));
  let added = 0;
  for (const channel of incoming) {
    if (byId.has(channel.id)) continue;
    byId.set(channel.id, {
      id: channel.id,
      title: channel.title,
      addedAt: now.toISOString(),
      error: null,
    });
    added++;
  }
  return { channels: [...byId.values()], added };
}

// ---------------------------------------------------------------------- feed

export interface FeedEntry {
  videoId: string;
  title: string;
  published: string;
  thumbnail: string;
  description: string;
  views: number | null;
}

export interface ParsedFeed {
  channelId: string | null;
  channelTitle: string | null;
  entries: FeedEntry[];
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function tagText(xml: string, tag: string): string | null {
  const open = xml.indexOf(`<${tag}>`);
  if (open < 0) return null;
  const close = xml.indexOf(`</${tag}>`, open);
  if (close < 0) return null;
  return decodeXml(xml.slice(open + tag.length + 2, close));
}

function tagAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`);
  const match = xml.match(re);
  return match ? decodeXml(match[1]) : null;
}

/**
 * Parse a channel feed without a DOM.
 *
 * The document is machine-generated by one publisher and its shape is fixed, so
 * a real XML parser buys nothing here — and hand-rolling it keeps this module
 * testable under plain `node --test`, where there is no DOMParser.
 */
export function parseChannelFeed(xml: string): ParsedFeed {
  const head = xml.split("<entry>")[0] ?? "";
  const entries: FeedEntry[] = [];

  for (const chunk of xml.split("<entry>").slice(1)) {
    const body = chunk.split("</entry>")[0] ?? chunk;
    const videoId = tagText(body, "yt:videoId");
    if (!videoId) continue;
    const views = tagAttr(body, "media:statistics", "views");
    entries.push({
      videoId,
      title: tagText(body, "media:title") ?? tagText(body, "title") ?? videoId,
      published: tagText(body, "published") ?? "",
      thumbnail: tagAttr(body, "media:thumbnail", "url") ?? "",
      description: tagText(body, "media:description") ?? "",
      views: views !== null && views !== "" ? Number(views) : null,
    });
  }

  // Not `<yt:channelId>` in the header: measured against a live feed, that tag
  // carries the ID with its `UC` prefix stripped, while the same tag inside an
  // entry carries it intact. Scanning for the full shape is right either way.
  return {
    channelId: parseChannelInput(head),
    channelTitle: tagText(head, "title"),
    entries,
  };
}

// --------------------------------------------------------------------- merge

/**
 * Fold a poll's worth of entries into the stored items.
 *
 * An item that is already known is never rewritten: its state, its note path
 * and — critically — its cached description stay as they were. A feed can
 * change a title or a description after publication, and the copy we captured
 * is the one the note was or will be built from.
 */
export function mergeItems(
  existing: HubItem[],
  channel: Channel,
  entries: FeedEntry[],
  now: Date,
): { items: HubItem[]; added: HubItem[] } {
  const known = new Set(existing.map((item) => item.videoId));
  const added: HubItem[] = [];

  for (const entry of entries) {
    if (known.has(entry.videoId)) continue;
    known.add(entry.videoId);
    added.push({
      videoId: entry.videoId,
      channelId: channel.id,
      channelTitle: channel.title,
      title: entry.title,
      published: entry.published,
      thumbnail: entry.thumbnail,
      description: entry.description,
      views: entry.views,
      isShort: null,
      state: "new",
      seenAt: now.toISOString(),
      origin: "feed",
    });
  }

  return { items: [...existing, ...added], added };
}

// -------------------------------------------------------------------- search

/**
 * A search hit, as a hub item.
 *
 * `published` is empty and stays empty: search states an age ("2 days ago"),
 * not a date, and the ANDROID player response carries no `microformat` to
 * recover one from. Guessing a date from the phrase would put a fabricated
 * value in the note's frontmatter to save a line of UI, so the hub shows no age
 * for a search item and it sorts with the undated tail, exactly as a Watch
 * Later item does.
 *
 * The description is passed in rather than fetched here: this file stays pure,
 * and the one player call it takes belongs to the caller — see
 * `fetchDescription` in `innertube.ts`. An empty string is a fine value; the
 * add is what the click asked for.
 */
export function searchResultToItem(
  result: SearchResult,
  description: string,
  now: Date,
  durationSeconds?: number | null,
): HubItem {
  return {
    videoId: result.videoId,
    channelId: result.channelId,
    channelTitle: result.channelTitle,
    title: result.title,
    published: "",
    thumbnail: result.thumbnail,
    description,
    views: result.views,
    // The player's own `lengthSeconds` when the caller has it, and search's
    // "55:31" when it does not. A search item is the one kind that arrives with
    // a duration already attached, so it never needs the backfill.
    durationSeconds: durationSeconds ?? parseDurationText(result.duration),
    isShort: null,
    state: "new",
    seenAt: now.toISOString(),
    origin: "search",
  };
}

// -------------------------------------------------------------------- hidden

/**
 * How many hidden videos are remembered. Oldest removal falls off first.
 *
 * A tombstone exists to stop a video you have already turned down coming back
 * at you — from a feed, and from a search. That job needs a list, not an
 * archive, so it is capped: at roughly 150 bytes each (see `hideItem`) this is
 * about 75 KB, on a phone, forever. A tombstone that falls off the end just
 * means the video may be offered again, which is the correct failure.
 */
export const HIDDEN_LIMIT = 500;

/**
 * The thumbnail for a video ID, without asking anyone.
 *
 * This is what makes dropping a hidden item's thumbnail free: the URL is
 * derivable, so nothing is lost by not storing it. `mqdefault` is the 320px
 * size a hub card draws, matching `pickThumbnail`.
 */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Hide a video: mark it Dismissed and strip it to a tombstone.
 *
 * The description is the only field in a `HubItem` with real size in it — a few
 * kilobytes each, and the hidden list is the one list that only ever grows — so
 * it goes, and the thumbnail URL with it since `thumbnailUrl` can rebuild one.
 * What is left is the identity, the title and when you hid it: enough to draw a
 * text row, and enough to recognise the video if you come looking for it.
 *
 * The description is not recoverable from anywhere but YouTube, which is why
 * `restoreItem`'s caller re-fetches it. That is the accepted cost of a hidden
 * list that does not grow without bound — see `issues/008-browse-round-two.md`.
 */
export function hideItem(item: HubItem, now: Date): void {
  item.state = "dismissed";
  item.dismissedAt = now.toISOString();
  item.description = "";
  item.thumbnail = "";
}

/**
 * Bring a hidden video back as if it were newly seen. The description it lost
 * on the way in is the caller's problem — see `hideItem`.
 */
export function restoreItem(item: HubItem): void {
  item.state = "new";
  delete item.dismissedAt;
  if (!item.thumbnail) item.thumbnail = thumbnailUrl(item.videoId);
}

/** Newest removal first — the Hidden list's own order. */
export function hiddenItems(items: HubItem[]): HubItem[] {
  return items
    .filter((item) => item.state === "dismissed")
    .sort((a, b) => (Date.parse(b.dismissedAt ?? "") || 0) - (Date.parse(a.dismissedAt ?? "") || 0));
}

/**
 * Drop New items past their sell-by date, and trim the hidden list to its cap.
 *
 * Age is measured from the publish date, not from when we first saw it. That
 * makes a fresh import trim itself to the last N days instead of dumping every
 * channel's entire 15-entry window into the hub, and it means "30 days" means
 * the same thing on both Macs.
 *
 * Kept items are never removed, and this function does not touch files. Expiry
 * removes a row from a JSON index; the note it produced is yours.
 *
 * Neither is anything you searched for. A feed item arrived because a channel
 * published it; a search item is there because you went looking for it by name,
 * and a list you built on purpose does not evaporate on a timer.
 *
 * Dismissed items used to be deleted here on the next poll, which is why there
 * was no way back from a removal and no Hidden list to have one in. They now
 * survive as tombstones and are bounded by `HIDDEN_LIMIT` instead of by age: a
 * removal you made a year ago is exactly as good a reason not to show you the
 * video as one you made this morning.
 */
export function expireItems(
  items: HubItem[],
  days: number,
  now: Date,
): { items: HubItem[]; removed: number } {
  const cutoff = now.getTime() - days * 86_400_000;
  const survivors = items.filter((item) => {
    if (item.state === "kept") return true;
    if (item.state === "dismissed") return true;
    if (days <= 0) return true;
    if (item.origin === "search") return true;
    const published = Date.parse(item.published);
    return Number.isFinite(published) ? published >= cutoff : true;
  });

  // The cap, applied to the tombstones only. Sorted by when they were hidden,
  // so what falls off is what you turned down longest ago.
  const hidden = hiddenItems(survivors);
  if (hidden.length > HIDDEN_LIMIT) {
    const doomed = new Set(hidden.slice(HIDDEN_LIMIT).map((item) => item.videoId));
    const kept = survivors.filter((item) => !doomed.has(item.videoId));
    return { items: kept, removed: items.length - kept.length };
  }

  return { items: survivors, removed: items.length - survivors.length };
}

export type HubFilter = "new" | "all" | "kept" | "hidden";

/**
 * What the hub shows, newest first, after the filters have had their say.
 *
 * Watched items are hidden from New and nowhere else: All and Kept are the two
 * places you go looking for something specific, and silently withholding it
 * there would be a bug rather than a filter. A Watch Later item carries no
 * publish date, so it sorts to the bottom of a list ordered by one — which is
 * right: it is the oldest thing there in every sense that matters.
 */
export function visibleItems(
  items: HubItem[],
  options: {
    filter: HubFilter;
    channelId: string | null;
    includeShorts: boolean;
    showWatched?: boolean;
    /** The hub's own search box: free text over title and channel. */
    query?: string;
  },
): HubItem[] {
  const matching = items.filter((item) => {
    if (options.channelId && item.channelId !== options.channelId) return false;
    if (!options.includeShorts && item.isShort === true) return false;
    if (!hubItemMatches(item, options.query ?? "")) return false;
    if (options.filter === "hidden") return item.state === "dismissed";
    if (options.filter === "new") {
      if (item.watched && !options.showWatched) return false;
      return item.state === "new";
    }
    if (options.filter === "kept") return item.state === "kept";
    return item.state !== "dismissed";
  });

  // Hidden is ordered by when you hid it, not by when the video came out. The
  // question you bring to that list is "what did I just remove", and half of
  // them have no publish date to sort by anyway.
  if (options.filter === "hidden") return hiddenItems(matching);

  return matching.sort(
    (a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0),
  );
}

/**
 * Does this item match what was typed into the hub's box?
 *
 * Title and channel, nothing else. Not the description: it is cached in full,
 * so matching it would turn "smarter" into every video that ever linked to that
 * channel, and the box is for finding a video you can already half-remember.
 *
 * Every whitespace-separated term has to match, in any order and anywhere —
 * "veritasium black" finds the one you mean without you recalling the title.
 * An empty query matches everything, which is what makes the box's default
 * state cost nothing.
 */
export function hubItemMatches(item: HubItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${item.title} ${item.channelTitle}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

// ---------------------------------------------------------------------- note

/** Illegal in a filename on some OS or in Obsidian's own link syntax. */
export function sanitizeFileName(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
}

/** YAML double-quoted scalar — titles contain colons, quotes and backslashes. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isoDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";
}

/**
 * The note a click produces — the same shape `8.Watch_Later_Template.md` makes,
 * built from cached feed data instead of a watch-page scrape.
 *
 * Every heading is level one. They are the note's only structure — Notes, the
 * description, the transcript — and a level-two heading with nothing above it
 * is a heading pretending to belong to a section that does not exist. It also
 * makes the outline, the fold defaults and the player's section buttons all
 * agree about what the top level of this note is.
 *
 * "Video Description" and "Video Transcript" rather than the bare words: a note
 * has notes and a description of its own in its frontmatter, and the two are
 * worth telling apart at a glance in the outline.
 *
 * `length` is written empty on purpose. The feed carries no duration, and
 * shelling out to yt-dlp for it would put a multi-second stall in front of a
 * click that should feel instant.
 */
export function buildWatchLaterNote(item: HubItem, now: Date): string {
  const url = `https://www.youtube.com/watch?v=${item.videoId}`;
  const lines = [
    "---",
    `title: ${quote(item.title)}`,
    `url: ${url}`,
    "author:",
    ...(item.channelTitle ? [`  - ${quote(item.channelTitle)}`] : []),
    `published: ${isoDate(item.published)}`,
    `created: ${now.toISOString().slice(0, 10)}`,
    "description: ",
    "tags: []",
    "domain: youtube.com",
    `media_link: ${url}`,
    "length: ",
    "---",
    NOTES_HEADING,
    // Two blank lines, not one. The cursor lands on the first and the second is
    // the gap between what you are writing and the heading under it, so a note
    // taken in one line does not sit flush against the description.
    "",
    "",
    DESCRIPTION_HEADING,
    // Real markdown links, written at creation time: the plugin also linkifies
    // at render time, but a link in the file survives the plugin being off.
    item.description
      ? linkifyTimestamps(item.description, item.videoId)
      : item.origin === "watchlater"
        ? "_From your YouTube Watch Later, which carries no description. It will fill in if this channel's feed still holds the video._"
        : item.origin === "search"
          ? "_YouTube returned no description for this video._"
          : "_No description in the channel feed._",
    "",
  ];
  return lines.join("\n");
}

/** "3 hours ago" / "2 days ago" — the only date format a feed list needs. */
export function relativeAge(published: string, now: Date): string {
  const time = Date.parse(published);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - time) / 1000));
  const units: Array<[number, string]> = [
    [31_536_000, "year"],
    [2_592_000, "month"],
    [604_800, "week"],
    [86_400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/**
 * The second line of a card, on a screen wide enough to spend on it: who,
 * when, how many, and every flag the item carries, spelled out.
 */
export function deskSub(item: HubItem, now: Date): string {
  const bits = [item.channelTitle, relativeAge(item.published, now), formatViews(item.views)];
  if (item.isShort) bits.push("Short");
  // Where it came from, and whether it is already seen. A Watch Later item has
  // no publish date, so without the label it looks like a bug.
  if (item.origin === "watchlater" || item.origin === "both") bits.push("Watch Later");
  // A search item carries no publish date either, for the same reason: say
  // where it came from and the missing age reads as a fact, not a bug.
  if (item.origin === "search") bits.push("Search");
  if (item.watched) bits.push("Watched");
  return bits.filter(Boolean).join(" · ");
}

/**
 * The same line on a phone: two facts, never more.
 *
 * The desktop line runs to seven segments, and the column it has to fit into on
 * a phone is about 180pt — so it truncated mid-word, every row broke in a
 * different place, and a list of them read as noise. The flags are not dropped,
 * they are shown instead of said: Short is the badge on the thumbnail, watched
 * is the dimmed thumbnail, and the Kept/Dismissed marker is already a badge.
 * View count is the one thing genuinely dropped — it is not what you choose by.
 *
 * An item with no publish date says where it came from in the age's place, so
 * the gap still reads as a fact rather than a bug.
 */
export function phoneSub(item: HubItem, now: Date): string {
  const age = relativeAge(item.published, now);
  const origin =
    item.origin === "search"
      ? "Search"
      : item.origin === "watchlater" || item.origin === "both"
        ? "Watch Later"
        : "";
  return [item.channelTitle, age || origin].filter(Boolean).join(" · ");
}

/**
 * "12:34", or "1:02:03" once there is an hour in it.
 *
 * Empty for anything that is not a real length, which includes both states a
 * `HubItem` can be in before a duration is known: never asked, and asked and
 * refused. The badge that draws this is hidden when it is empty, so a card
 * whose duration has not landed yet is the same card, minus one fact.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** The inverse, for search's "55:31" — the one place a duration arrives as text. */
export function parseDurationText(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part.trim())) return null;
    seconds = seconds * 60 + Number(part);
  }
  return seconds > 0 ? seconds : null;
}

/**
 * A description, flattened to something a two-line clamp can hold.
 *
 * A YouTube description is mostly not prose: chapter lists, affiliate links,
 * social handles and a wall of hashtags, laid out over forty lines. The first
 * couple of sentences are the part that tells you what the video is, so the
 * lines that are plainly not that — a bare URL, a chapter stamp, a hashtag run
 * — are dropped rather than truncated into.
 *
 * Cut to `maxChars` so a card never carries five kilobytes of text into the DOM
 * for two lines of it to be visible. The CSS clamp is what the reader sees; this
 * is what stops a list of two hundred cards being built out of whole
 * descriptions.
 */
export function cardBlurb(description: string, maxChars = 220): string {
  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^https?:\/\/\S+$/.test(line)) return false;
      // "0:00 Intro" and friends: a chapter list is navigation, not a summary.
      if (/^\(?\d{1,2}:\d{2}(:\d{2})?\)?\b/.test(line)) return false;
      if (/^#\S+(\s+#\S+)*$/.test(line)) return false;
      return true;
    });

  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
}

/** "1.2M views" — a raw seven-digit number is harder to read at a glance. */
export function formatViews(views: number | null): string {
  if (views === null || !Number.isFinite(views)) return "";
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  if (views >= 1_000) return `${Math.round(views / 1000)}K views`;
  return `${views} views`;
}
