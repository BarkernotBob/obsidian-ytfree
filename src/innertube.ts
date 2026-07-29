/**
 * Every request this plugin makes to InnerTube, and the client identities it
 * makes them as.
 *
 * `requestUrl` rather than `fetch`, and this is not a preference: on iOS the
 * webview origin is `capacitor://localhost` and youtube.com sends no
 * `Access-Control-Allow-Origin`, so a plain `fetch` is refused before it is
 * sent. `requestUrl` goes through the native layer, which has no CORS and
 * accepts the custom User-Agent a client context has to be paired with. It
 * exists on desktop too, which is why browse is the same code on both.
 *
 * The parsers live elsewhere and are pure: `mobile/player-response.ts` for the
 * player, `search.ts` for search. This file is only the requests.
 */

import { requestUrl } from "obsidian";
import { CLIENTS, PLAYER_URL, SEARCH_URL, playerBody } from "./innertube-context.ts";
import { parseSearchResponse } from "./search.ts";
import type { SearchPage } from "./search.ts";
import { defaultFilters, encodeSearchParams } from "./search-params.ts";
import type { SearchFilters } from "./search-params.ts";
import { pickPlayerCaptionTrack } from "./transcript.ts";
import type { CaptionedPlayerResponse, CaptionTrack } from "./transcript.ts";

// The client identities live next door, in a file with no `obsidian` import, so
// the live smoke test can send the same request this file sends.
export * from "./innertube-context.ts";

/** A request that never reached a parseable response. */
export class InnertubeError extends Error {}

/**
 * One InnerTube POST. `hl`/`gl` are pinned to `en`/`US` here, as everywhere
 * else in this plugin, so a result reads the same on any machine.
 */
export async function callInnertube(
  url: string,
  client: keyof typeof CLIENTS,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { ctx, ua } = CLIENTS[client];
  let response;
  try {
    response = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ua },
      body: JSON.stringify({ ...body, context: { client: { ...ctx, hl: "en", gl: "US" } } }),
      // Handled here, so a 4xx reads as a network failure rather than throwing
      // an Obsidian error object at the caller.
      throw: false,
    });
  } catch (err) {
    throw new InnertubeError(err instanceof Error ? err.message : String(err));
  }

  if (response.status < 200 || response.status >= 300) {
    throw new InnertubeError(`YouTube answered HTTP ${response.status}.`);
  }

  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new InnertubeError("YouTube's response was not JSON.");
  }
}

/**
 * Search, or the next page of one.
 *
 * A continuation is a whole separate call shape — token instead of query — and
 * the response comes back in a different envelope, which `parseSearchResponse`
 * absorbs. Signed out, always: unauthenticated results are not personalised,
 * and that is the point.
 *
 * The filters ride along as `params`, YouTube's own encoding of its own filter
 * panel — see `search-params.ts`. A continuation carries the filters of the
 * search that produced it, so page two needs the token and nothing else; the
 * filters are passed anyway and simply have nowhere to go.
 */
export async function searchYouTube(
  query: string,
  filters: SearchFilters = defaultFilters(),
  continuation: string | null = null,
): Promise<SearchPage> {
  const body = continuation
    ? { continuation }
    : { query, params: encodeSearchParams(filters) };
  return parseSearchResponse(await callInnertube(SEARCH_URL, "android", body));
}

/** What one player call is worth to the hub: the two facts a feed lacks. */
export interface VideoDetails {
  description: string;
  /** Seconds, or null when the video would not answer. */
  durationSeconds: number | null;
}

/**
 * The description and length of one video.
 *
 * Search carries no description on any client and a channel feed carries no
 * duration on any day, and the hub's whole premise is that both are cached
 * before they can go stale — so this is the one extra round trip, and it is the
 * same call either fact comes from. It answers empty rather than throwing when
 * the video is private, age-gated or gone: an item with neither is still worth
 * having, and it is the caller's job to decide what to do about that.
 */
export async function fetchVideoDetails(videoId: string): Promise<VideoDetails> {
  try {
    const response = await callInnertube(PLAYER_URL, "android", playerBody(videoId));
    const details = (response as {
      videoDetails?: { shortDescription?: unknown; lengthSeconds?: unknown };
    }).videoDetails;
    // `lengthSeconds` is a *string* of digits in every player response measured.
    const length = Number(details?.lengthSeconds);
    return {
      description: typeof details?.shortDescription === "string" ? details.shortDescription : "",
      durationSeconds: Number.isFinite(length) && length > 0 ? length : null,
    };
  } catch {
    return { description: "", durationSeconds: null };
  }
}

/** The description alone, for callers that have a duration already. */
export async function fetchDescription(videoId: string): Promise<string> {
  return (await fetchVideoDetails(videoId)).description;
}

/**
 * The best caption track for a video, without yt-dlp.
 *
 * This is the phone's whole transcript story. The player response carries the
 * caption tracklist on the ANDROID client — measured — and the signed
 * `baseUrl` it hands back is not IP-locked, so `requestUrl` can fetch it
 * straight afterwards. Throws `InnertubeError` on a failed request; answers
 * null when the video simply has no captions in that language, because those
 * are different facts and the caller says different things about them.
 */
export async function fetchCaptionTrack(
  videoId: string,
  language: string,
): Promise<CaptionTrack | null> {
  const response = await callInnertube(PLAYER_URL, "android", playerBody(videoId));
  return pickPlayerCaptionTrack(response as CaptionedPlayerResponse, language);
}
