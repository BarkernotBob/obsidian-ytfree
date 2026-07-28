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
}

/** A channel feed, your Watch Later list, or both. */
export type ItemOrigin = "feed" | "watchlater" | "both";

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

/**
 * Drop New items past their sell-by date, and Dismissed items immediately.
 *
 * Age is measured from the publish date, not from when we first saw it. That
 * makes a fresh import trim itself to the last N days instead of dumping every
 * channel's entire 15-entry window into the hub, and it means "30 days" means
 * the same thing on both Macs.
 *
 * Kept items are never removed, and this function does not touch files. Expiry
 * removes a row from a JSON index; the note it produced is yours.
 */
export function expireItems(
  items: HubItem[],
  days: number,
  now: Date,
): { items: HubItem[]; removed: number } {
  if (days <= 0) return { items, removed: 0 };
  const cutoff = now.getTime() - days * 86_400_000;
  const kept = items.filter((item) => {
    if (item.state === "kept") return true;
    if (item.state === "dismissed") return false;
    const published = Date.parse(item.published);
    return Number.isFinite(published) ? published >= cutoff : true;
  });
  return { items: kept, removed: items.length - kept.length };
}

export type HubFilter = "new" | "all" | "kept";

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
  },
): HubItem[] {
  return items
    .filter((item) => {
      if (options.channelId && item.channelId !== options.channelId) return false;
      if (!options.includeShorts && item.isShort === true) return false;
      if (options.filter === "new") {
        if (item.watched && !options.showWatched) return false;
        return item.state === "new";
      }
      if (options.filter === "kept") return item.state === "kept";
      return item.state !== "dismissed";
    })
    .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
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
    "## Notes",
    "",
    "## Description",
    // Real markdown links, written at creation time: the plugin also linkifies
    // at render time, but a link in the file survives the plugin being off.
    item.description
      ? linkifyTimestamps(item.description, item.videoId)
      : item.origin === "watchlater"
        ? "_From your YouTube Watch Later, which carries no description. It will fill in if this channel's feed still holds the video._"
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

/** "1.2M views" — a raw seven-digit number is harder to read at a glance. */
export function formatViews(views: number | null): string {
  if (views === null || !Number.isFinite(views)) return "";
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  if (views >= 1_000) return `${Math.round(views / 1000)}K views`;
  return `${views} views`;
}
