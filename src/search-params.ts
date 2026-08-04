/**
 * YouTube's search filters, as the one opaque string YouTube actually accepts.
 *
 * The filter panel on youtube.com is not a set of query arguments. Every choice
 * in it — upload date, duration, sort, the feature checkboxes — is folded into a
 * single `params` field on the search request, and that field is a base64url
 * protobuf. So there is no way to offer YouTube's filters without encoding it,
 * and no library worth adding for what amounts to varints in two messages.
 *
 * This file is pure and has no `obsidian` import, so `spikes/search-filters/`
 * can send exactly what the plugin sends. That mattered: a wrong `params` is
 * *ignored* by YouTube rather than rejected, so the only way to know an encoding
 * is right is to assert on the content of the results, which the spike does.
 *
 * Measured 2026-07-28 (see `issues/008-browse-round-two.md`): upload date,
 * duration, type and the feature bools all apply on the ANDROID client. Sort
 * applies too, with one honest caveat recorded in the issue — YouTube injects a
 * couple of promoted videos into a sorted list and they are indistinguishable
 * from real results.
 *
 *   message SearchRequestParams {
 *     optional int32       sort_by = 1;
 *     optional SearchFilter filters = 2;
 *   }
 *   message SearchFilter {
 *     optional int32 upload_date = 1;
 *     optional int32 type        = 2;
 *     optional int32 duration    = 3;
 *     optional bool  hd = 4; subtitles = 5; creative_commons = 6; live = 8;
 *     optional bool  four_k = 14;
 *   }
 */

// --------------------------------------------------------------- the choices

export type UploadDate = "any" | "hour" | "today" | "week" | "month" | "year";
export type Duration = "any" | "short" | "medium" | "long";
export type SortBy = "relevance" | "date" | "views" | "rating";
export type Feature = "any" | "live" | "fourK" | "hd" | "subtitles" | "creativeCommons";

export interface SearchFilters {
  uploadDate: UploadDate;
  duration: Duration;
  sort: SortBy;
  /**
   * One at a time, not YouTube's checkbox set. A single control is what keeps
   * the filter bar from changing height when a choice is made — see the app
   * rule about clicks never reflowing anything.
   */
  feature: Feature;
}

export function defaultFilters(): SearchFilters {
  return { uploadDate: "any", duration: "any", sort: "relevance", feature: "any" };
}

/**
 * Which of the four are away from their default.
 *
 * The filter bar marks a narrowed control so you can see, without opening four
 * dropdowns, why a search came back with three results. The mark is a colour
 * change on a box whose size is already fixed — it cannot be a border that
 * appears, or a label that goes bold, because either would re-measure the
 * control and move the results underneath it.
 */
export function nonDefaultFilters(filters: SearchFilters): Record<keyof SearchFilters, boolean> {
  const base = defaultFilters();
  return {
    uploadDate: filters.uploadDate !== base.uploadDate,
    duration: filters.duration !== base.duration,
    sort: filters.sort !== base.sort,
    feature: filters.feature !== base.feature,
  };
}

export function isDefaultFilters(filters: SearchFilters): boolean {
  return !Object.values(nonDefaultFilters(filters)).some(Boolean);
}

/** Label, value — in the order the control offers them. */
export const UPLOAD_DATE_OPTIONS: Array<[UploadDate, string]> = [
  ["any", "Any time"],
  ["hour", "Last hour"],
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["year", "This year"],
];

export const DURATION_OPTIONS: Array<[Duration, string]> = [
  ["any", "Any length"],
  ["short", "Under 4 minutes"],
  ["medium", "4–20 minutes"],
  ["long", "Over 20 minutes"],
];

export const SORT_OPTIONS: Array<[SortBy, string]> = [
  ["relevance", "Relevance"],
  ["date", "Upload date"],
  ["views", "View count"],
  ["rating", "Rating"],
];

export const FEATURE_OPTIONS: Array<[Feature, string]> = [
  ["any", "Any type"],
  ["live", "Live"],
  ["fourK", "4K"],
  ["hd", "HD"],
  ["subtitles", "Subtitles"],
  ["creativeCommons", "Creative Commons"],
];

// ---------------------------------------------------------- the field numbers

const UPLOAD_DATE: Record<UploadDate, number> = {
  any: 0,
  hour: 1,
  today: 2,
  week: 3,
  month: 4,
  year: 5,
};

// Not in size order, and not a mistake: this is YouTube's numbering.
const DURATION: Record<Duration, number> = { any: 0, short: 1, long: 2, medium: 3 };

const SORT: Record<SortBy, number> = { relevance: 0, rating: 1, date: 2, views: 3 };

/** Which bool field on `SearchFilter` each feature is. */
const FEATURE: Record<Feature, number> = {
  any: 0,
  hd: 4,
  subtitles: 5,
  creativeCommons: 6,
  live: 8,
  fourK: 14,
};

/**
 * Every search this plugin makes asks for videos.
 *
 * `src/search.ts` reads one renderer and understands nothing else, so pinning
 * the type removes the channel and playlist entries from the *response* rather
 * than from our reading of it — cheaper, and it means twenty results are twenty
 * videos instead of seventeen videos and three things we threw away.
 */
const TYPE_VIDEO = 1;

// ------------------------------------------------------------------ protobuf

/** Base-128 varint, little-endian, high bit as the continuation flag. */
function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value >>> 0;
  while (rest > 127) {
    out.push((rest & 127) | 128);
    rest >>>= 7;
  }
  out.push(rest);
  return out;
}

/** A field key: the number in the high bits, the wire type in the low three. */
function key(field: number, wire: 0 | 2): number[] {
  return varint((field << 3) | wire);
}

function varintField(field: number, value: number): number[] {
  return [...key(field, 0), ...varint(value)];
}

function messageField(field: number, bytes: number[]): number[] {
  return [...key(field, 2), ...varint(bytes.length), ...bytes];
}

/**
 * Base64url without padding — the alphabet YouTube's own `&sp=` uses.
 *
 * Hand-rolled rather than `Buffer` (not in a browser) or `btoa` (not in the
 * smoke test's plain Node, and it takes a binary string rather than bytes).
 * This file has to run in both.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += ALPHABET[c & 63];
  }
  return out;
}

/**
 * The `params` string for a set of filters, or "" when there is nothing to say.
 *
 * A zero-valued proto3 field is not on the wire, which is exactly what "Any
 * time" means — so the encoding of "no filters" is a request with the type
 * pinned and nothing else.
 */
export function encodeSearchParams(filters: SearchFilters): string {
  const filter: number[] = [];
  const uploadDate = UPLOAD_DATE[filters.uploadDate] ?? 0;
  const duration = DURATION[filters.duration] ?? 0;
  const feature = FEATURE[filters.feature] ?? 0;

  // Ascending field order. Not required by protobuf, but it makes the string
  // byte-identical to YouTube's own for the same choices, which is what makes
  // these testable against values read off youtube.com.
  if (uploadDate) filter.push(...varintField(1, uploadDate));
  filter.push(...varintField(2, TYPE_VIDEO));
  if (duration) filter.push(...varintField(3, duration));
  if (feature) filter.push(...varintField(feature, 1));

  const params: number[] = [];
  const sort = SORT[filters.sort] ?? 0;
  if (sort) params.push(...varintField(1, sort));
  params.push(...messageField(2, filter));

  return base64url(params);
}
