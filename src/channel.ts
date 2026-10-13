/**
 * One channel's catalogue, as a pure function over InnerTube's `browse` tree.
 *
 * Issue 045 and `docs/V1-SCOPE-CHANNEL-SCREEN.md`. The 15-entry RSS feed is
 * what the hub polls; this is the rest of a channel — its whole Videos tab,
 * newest first, paged by continuation — and a search over it.
 *
 * WEB client, not ANDROID like search: measured 2026-10-13, ANDROID answers a
 * channel `browse` with HTTP 400, and WEB answers it with the same page
 * youtube.com draws. WEB is already the identity the heatmap uses on the phone,
 * so it is known to work through `requestUrl` on iOS too.
 *
 * Three shapes come back, and all three are read here:
 *
 * - **Videos tab, page one**: `richGridRenderer` → `richItemRenderer` →
 *   `lockupViewModel`, with the next page's token in a `continuationItemRenderer`
 *   at the end of the grid. The page header (name, handle, avatar, counts) rides
 *   along.
 * - **A continuation**: the same items under
 *   `onResponseReceivedActions[].appendContinuationItemsAction`.
 * - **A search inside the channel**: the Search tab, `itemSectionRenderer` →
 *   `videoRenderer`, the older renderer search used to use on WEB.
 *
 * Like `search.ts`, nothing here throws: the tree is undocumented, and every
 * step degrades to "nothing found" rather than an exception in a screen.
 */

import { pickThumbnail, parseViewCount } from "./search.ts";
import type { SearchResult } from "./search.ts";

/** The Videos tab: YouTube's own `params` for "this channel, tab = videos". */
export const CHANNEL_VIDEOS_PARAMS = "EgZ2aWRlb3PyBgQKAjoA";
/** The Search tab. The query rides alongside it as `query`. */
export const CHANNEL_SEARCH_PARAMS = "EgZzZWFyY2jyBgQKAloA";

/** The facts at the top of the screen. Every field may be empty. */
export interface ChannelHeader {
  channelId: string;
  title: string;
  /** "@wardonwords", or "". */
  handle: string;
  /** "40.6K subscribers", verbatim — YouTube already rounded it. */
  subscribers: string;
  /** "418 videos", verbatim. */
  videos: string;
  /** A small square avatar, or "". */
  avatar: string;
}

export interface ChannelPage {
  /** Present on page one of the Videos tab and on a channel search; never on a continuation. */
  header: ChannelHeader | null;
  results: SearchResult[];
  continuation: string | null;
}

export function emptyChannelPage(): ChannelPage {
  return { header: null, results: [], continuation: null };
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

export function isChannelId(value: string): boolean {
  return CHANNEL_ID_RE.test(value);
}

/** The channel's own page on youtube.com — where Subscribe sends you. */
export function channelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function at(root: unknown, ...path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    const object = record(node);
    if (!object) return undefined;
    node = object[key];
  }
  return node;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `{ simpleText }`, `{ runs }`, or the view-model spelling `{ content }`. */
function text(value: unknown): string {
  const object = record(value);
  if (!object) return "";
  if (typeof object.simpleText === "string") return object.simpleText;
  if (typeof object.content === "string") return object.content;
  return array(object.runs)
    .map((run) => str(at(run, "text")))
    .join("")
    .trim();
}

/**
 * "4.5K views" → 4500, "1.2M views" → 1200000, "5,736 views" → 5736.
 *
 * The lockup only ever states the rounded form, and `parseViewCount` would
 * read "4.5K" as 45. Close enough is the most this field can be; the card
 * formats it back to the same rounding anyway.
 */
export function parseShortViews(value: string): number | null {
  const match = value.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? "").toUpperCase()] ?? 1;
  return scale === 1 ? parseViewCount(value) : Math.round(base * scale);
}

/** "9:31" or "1:02:03". Anything else on the badge — LIVE, UPCOMING — is not a length. */
const LENGTH_RE = /^\d{1,2}(:\d{2}){1,2}$/;

/**
 * One item off the Videos grid.
 *
 * A lockup carries no byline — on a channel's own page the channel goes
 * without saying — so the channel comes from the caller, who read it off the
 * page header. Members-only videos are dropped: they cannot be played signed
 * out, and a card for something that cannot play is a broken promise.
 */
function parseLockup(raw: unknown, channelId: string, channelTitle: string): SearchResult | null {
  const lockup = record(raw);
  if (!lockup) return null;
  if (str(lockup.contentType) !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
  const videoId = str(lockup.contentId);
  if (!VIDEO_ID_RE.test(videoId)) return null;

  const meta = record(at(lockup, "metadata", "lockupMetadataViewModel"));
  const rows = array(at(meta, "metadata", "contentMetadataViewModel", "metadataRows"));
  const parts: string[] = [];
  let membersOnly = false;
  for (const row of rows) {
    for (const part of array(at(row, "metadataParts"))) {
      const value = text(at(part, "text"));
      if (value) parts.push(value);
    }
    for (const badge of array(at(row, "badges"))) {
      if (str(at(badge, "badgeViewModel", "badgeStyle")) === "BADGE_MEMBERS_ONLY") membersOnly = true;
    }
  }
  if (membersOnly) return null;

  const viewsPart = parts.find((part) => /\bviews?\b/i.test(part)) ?? "";
  const publishedPart = parts.find((part) => /\bago\b|^Streamed|^Premiere|^Scheduled/i.test(part)) ?? "";

  const image = at(lockup, "contentImage", "thumbnailViewModel");
  let duration = "";
  for (const overlay of array(at(image, "overlays"))) {
    for (const badge of array(at(overlay, "thumbnailBottomOverlayViewModel", "badges"))) {
      const value = str(at(badge, "thumbnailBadgeViewModel", "text"));
      if (LENGTH_RE.test(value)) duration = value;
    }
  }

  return {
    videoId,
    title: text(at(meta, "title")) || videoId,
    channelId,
    channelTitle,
    publishedText: publishedPart,
    views: viewsPart ? parseShortViews(viewsPart) : null,
    duration,
    thumbnail: pickThumbnail(at(image, "image", "sources")),
    secondary: false,
  };
}

/** One result of a search inside the channel: the older `videoRenderer`. */
function parseVideoRenderer(raw: unknown, channelId: string, channelTitle: string): SearchResult | null {
  const video = record(raw);
  if (!video) return null;
  const videoId = str(video.videoId);
  if (!VIDEO_ID_RE.test(videoId)) return null;
  // Same rule as the grid. A members-only search hit says so with a badge.
  const badges = JSON.stringify(video.badges ?? []);
  if (badges.includes("BADGE_STYLE_TYPE_MEMBERS_ONLY")) return null;

  const byline = record(video.ownerText) ?? record(video.longBylineText) ?? record(video.shortBylineText);
  const bylineId = str(at(array(at(byline, "runs"))[0], "navigationEndpoint", "browseEndpoint", "browseId"));
  return {
    videoId,
    title: text(video.title) || videoId,
    channelId: CHANNEL_ID_RE.test(bylineId) ? bylineId : channelId,
    channelTitle: text(byline) || channelTitle,
    publishedText: text(video.publishedTimeText),
    views: parseViewCount(text(video.viewCountText)),
    duration: text(video.lengthText),
    thumbnail: pickThumbnail(at(video, "thumbnail", "thumbnails")),
    secondary: false,
  };
}

function continuationToken(raw: unknown): string | null {
  const token = at(raw, "continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token");
  return typeof token === "string" && token ? token : null;
}

/**
 * The name, handle, counts and avatar.
 *
 * Read from `pageHeaderViewModel` first, which is what the page draws, then
 * from `channelMetadataRenderer` for whatever the header did not have — the
 * metadata block has the name and ID on every response measured, but no counts.
 */
export function parseChannelHeader(raw: unknown): ChannelHeader | null {
  const metadata = record(at(raw, "metadata", "channelMetadataRenderer"));
  const view = record(at(raw, "header", "pageHeaderRenderer", "content", "pageHeaderViewModel"));
  if (!metadata && !view) return null;

  const parts: string[] = [];
  for (const row of array(at(view, "metadata", "contentMetadataViewModel", "metadataRows"))) {
    for (const part of array(at(row, "metadataParts"))) {
      const value = text(at(part, "text"));
      if (value) parts.push(value);
    }
  }

  const avatarSources = at(
    view,
    "image",
    "decoratedAvatarViewModel",
    "avatar",
    "avatarViewModel",
    "image",
    "sources",
  );
  const smallest = array(avatarSources)
    .map((entry) => ({ url: str(at(entry, "url")), width: Number(at(entry, "width")) || 0 }))
    .filter((entry) => entry.url)
    .sort((a, b) => a.width - b.width)[0];
  const fallbackAvatar = str(at(array(at(metadata, "avatar", "thumbnails"))[0], "url"));

  const channelId = str(metadata?.externalId);
  return {
    channelId: CHANNEL_ID_RE.test(channelId) ? channelId : "",
    title:
      text(at(view, "title", "dynamicTextViewModel", "text")) || str(metadata?.title),
    handle: parts.find((part) => part.startsWith("@")) ?? "",
    subscribers: parts.find((part) => /subscriber/i.test(part)) ?? "",
    videos: parts.find((part) => /\bvideos?\b/i.test(part)) ?? "",
    avatar: smallest?.url || fallbackAvatar,
  };
}

/** The tab YouTube marked selected — the one whose content answers the request. */
function selectedTabContent(raw: unknown): unknown {
  for (const tab of array(at(raw, "contents", "twoColumnBrowseResultsRenderer", "tabs"))) {
    const renderer = record(at(tab, "tabRenderer")) ?? record(at(tab, "expandableTabRenderer"));
    if (renderer?.selected === true) return renderer.content;
  }
  return undefined;
}

/**
 * Page one of the Videos tab, a continuation of it, or a channel search.
 *
 * `channel` names whose catalogue this is, for the cards: a continuation
 * carries no header to read it from, and a grid lockup carries no byline.
 */
export function parseChannelResponse(
  raw: unknown,
  channel: { channelId: string; channelTitle: string },
): ChannelPage {
  const header = parseChannelHeader(raw);
  const channelId = header?.channelId || channel.channelId;
  const channelTitle = header?.title || channel.channelTitle;

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let continuation: string | null = null;
  const take = (result: SearchResult | null): void => {
    if (!result || seen.has(result.videoId)) return;
    seen.add(result.videoId);
    results.push(result);
  };

  // A Videos page or one of its continuations: a flat list of grid items.
  const gridItems = (items: unknown[]): void => {
    for (const item of items) {
      const lockup = at(item, "richItemRenderer", "content", "lockupViewModel");
      if (lockup) take(parseLockup(lockup, channelId, channelTitle));
      continuation = continuationToken(item) ?? continuation;
    }
  };

  const content = selectedTabContent(raw);
  const grid = record(at(content, "richGridRenderer"));
  if (grid) gridItems(array(grid.contents));

  for (const action of array(at(raw, "onResponseReceivedActions"))) {
    const items =
      at(action, "appendContinuationItemsAction", "continuationItems") ??
      at(action, "reloadContinuationItemsCommand", "continuationItems");
    gridItems(array(items));
    // A channel search's later pages arrive the same way, as item sections.
    for (const item of array(items)) {
      for (const entry of array(at(item, "itemSectionRenderer", "contents"))) {
        const video = at(entry, "videoRenderer");
        if (video) take(parseVideoRenderer(video, channelId, channelTitle));
      }
    }
  }

  // The Search tab: item sections, one video each, and maybe a token after them.
  for (const section of array(at(content, "sectionListRenderer", "contents"))) {
    for (const entry of array(at(section, "itemSectionRenderer", "contents"))) {
      const video = at(entry, "videoRenderer");
      if (video) take(parseVideoRenderer(video, channelId, channelTitle));
    }
    continuation = continuationToken(section) ?? continuation;
  }

  return { header, results, continuation };
}

/**
 * When a video was published, from a WEB player response, as an ISO string.
 *
 * The WEB player's `microformat` carries it (`publishDate`, else `uploadDate`);
 * the ANDROID player the rest of the plugin uses carries no microformat at all.
 * "" when the response has neither, which every caller treats as undated.
 * Used by the backfill (048), which must write real dates: its items have to
 * be indistinguishable from feed items, and expiry runs on this field.
 */
export function parsePlayerPublishDate(raw: unknown): string {
  const micro = at(raw, "microformat", "playerMicroformatRenderer");
  for (const key of ["publishDate", "uploadDate"]) {
    const value = str(at(micro, key));
    const time = Date.parse(value);
    if (value && Number.isFinite(time)) return new Date(time).toISOString();
  }
  return "";
}
