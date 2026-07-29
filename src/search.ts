/**
 * YouTube search, as a pure function over InnerTube's renderer tree.
 *
 * See `docs/V1-SCOPE-BROWSE.md` for why browse is an API call rendered by us
 * rather than YouTube's own page in a `<webview>`: the ad-free, shelf-free
 * result is then a property of the design instead of a filter that has to keep
 * winning. This file is where that property actually lives.
 *
 * It reads exactly one renderer — `compactVideoRenderer`, from the item
 * sections — and refuses everything else in the response by never looking at
 * it. Ads (`elementRenderer` with an ad slot) and "people also watched" shelves
 * (`horizontalCardListRenderer` full of `videoCardRenderer`) are both in the
 * payload, measured; neither can reach the hub because neither is that one
 * renderer. That is also why this walks the section contents by path rather
 * than scanning the tree for video IDs — a scan would happily find the shelves.
 *
 * Nothing here throws. The tree is undocumented and can change without notice,
 * so every step degrades to "no results" instead: an empty list is a UI state,
 * an exception in a search box is a bug report.
 *
 * The request lives in `innertube.ts`; this file is pure so it can be tested
 * against recorded fixtures with no app and no network — see
 * `spikes/search/record.mjs`.
 */

/** One search hit, before it becomes a `HubItem`. */
export interface SearchResult {
  videoId: string;
  title: string;
  /** `UC…`, or "" when the byline carried no browse endpoint. */
  channelId: string;
  channelTitle: string;
  /**
   * "2 days ago" — search states an age, not a date, and the ANDROID player
   * response carries no `microformat` to recover one from. The relative string
   * is therefore the only publish information browse will ever have.
   */
  publishedText: string;
  views: number | null;
  /** "55:31". The feed has no equivalent, which is why it is shown here. */
  duration: string;
  thumbnail: string;
}

export interface SearchPage {
  results: SearchResult[];
  /** Token for the next page, or null when YouTube offered none. */
  continuation: string | null;
}

export function emptyPage(): SearchPage {
  return { results: [], continuation: null };
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Follow a path of object keys, giving up at the first thing that is not one. */
function at(root: unknown, ...path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    const object = record(node);
    if (!object) return undefined;
    node = object[key];
  }
  return node;
}

/**
 * InnerTube spells text two ways — `{ runs: [{ text }] }` and
 * `{ simpleText }` — and which one you get varies by field and by client.
 */
function text(value: unknown): string {
  const object = record(value);
  if (!object) return "";
  if (typeof object.simpleText === "string") return object.simpleText;
  return array(object.runs)
    .map((run) => {
      const t = at(run, "text");
      return typeof t === "string" ? t : "";
    })
    .join("")
    .trim();
}

/**
 * "1,353,645 views" → 1353645, so the hub can render it with the same
 * `formatViews` a feed item gets and the two card kinds read alike.
 */
export function parseViewCount(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const views = Number(digits);
  return Number.isFinite(views) ? views : null;
}

/**
 * The thumbnail closest to the size a hub card draws.
 *
 * YouTube returns four widths, largest last, and the card is ~120px on a phone
 * and ~160px on the desktop. `mqdefault` (320) is the right one; taking the
 * last would pull an 640px image per row for nothing.
 */
export function pickThumbnail(thumbnails: unknown): string {
  const candidates = array(thumbnails)
    .map((entry) => {
      const object = record(entry);
      const url = object && typeof object.url === "string" ? object.url : "";
      const width = object && typeof object.width === "number" ? object.width : 0;
      return { url, width };
    })
    .filter((entry) => entry.url);
  if (candidates.length === 0) return "";
  const wide = candidates.filter((entry) => entry.width >= 320);
  const chosen = wide.length
    ? wide.reduce((best, entry) => (entry.width < best.width ? entry : best))
    : candidates.reduce((best, entry) => (entry.width > best.width ? entry : best));
  // Protocol-relative URLs show up on some image hosts; `<img src>` would
  // resolve one against `capacitor://localhost` on iOS and fetch nothing.
  return chosen.url.startsWith("//") ? `https:${chosen.url}` : chosen.url;
}

function parseVideo(raw: unknown): SearchResult | null {
  const video = record(raw);
  if (!video) return null;
  const videoId = typeof video.videoId === "string" ? video.videoId : "";
  if (!VIDEO_ID_RE.test(videoId)) return null;

  const byline = record(video.longBylineText) ?? record(video.shortBylineText);
  const firstRun = array(at(byline, "runs"))[0];
  const channelId = at(firstRun, "navigationEndpoint", "browseEndpoint", "browseId");

  return {
    videoId,
    title: text(video.title) || videoId,
    channelId: typeof channelId === "string" && CHANNEL_ID_RE.test(channelId) ? channelId : "",
    channelTitle: text(byline),
    publishedText: text(video.publishedTimeText),
    // The long form is the one with the exact number in it; the short form
    // ("1.3M views") is a formatting of it we would only have to undo.
    views: parseViewCount(text(video.viewCountText) || text(video.shortViewCountText)),
    duration: text(video.lengthText),
    thumbnail: pickThumbnail(at(video, "thumbnail", "thumbnails")),
  };
}

/**
 * Page one lives under `contents.sectionListRenderer`; a continuation answers
 * under `continuationContents.sectionListContinuation`. Same contents shape,
 * different envelope — this is the only difference between the two calls.
 */
function sectionList(response: unknown): Record<string, unknown> | null {
  return (
    record(at(response, "contents", "sectionListRenderer")) ??
    record(at(response, "continuationContents", "sectionListContinuation"))
  );
}

export function parseSearchResponse(raw: unknown): SearchPage {
  const root = sectionList(raw);
  if (!root) return emptyPage();

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const section of array(root.contents)) {
    for (const entry of array(at(section, "itemSectionRenderer", "contents"))) {
      const object = record(entry);
      if (!object || !("compactVideoRenderer" in object)) continue;
      const result = parseVideo(object.compactVideoRenderer);
      // A query and its continuation can repeat a video; the hub would show it
      // twice under one More results click.
      if (!result || seen.has(result.videoId)) continue;
      seen.add(result.videoId);
      results.push(result);
    }
  }

  const token = at(
    array(root.continuations)[0],
    "nextContinuationData",
    "continuation",
  );
  return {
    results,
    continuation: typeof token === "string" && token ? token : null,
  };
}
