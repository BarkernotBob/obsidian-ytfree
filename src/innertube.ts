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
import { isAgeGatedAnswer, reportAgeRestricted } from "./age-restricted.ts";
import { botCheck, isBotCheckPlayability } from "./bot-check.ts";
import { trimPlayerAnswer } from "./answer-trim.ts";
import { InfoCache } from "./info-cache.ts";
import type { AnswerStore } from "./info-cache.ts";
import { governor } from "./request-governor.ts";
import { EXPIRY_SAFETY_MARGIN_MS } from "./stream.ts";
import {
  BROWSE_URL,
  CLIENTS,
  NEXT_URL,
  PLAYER_URL,
  SEARCH_URL,
  playerBody,
  requestContext,
} from "./innertube-context.ts";
import {
  CHANNEL_SEARCH_PARAMS,
  CHANNEL_VIDEOS_PARAMS,
  parseChannelResponse,
  parsePlayerPublishDate,
} from "./channel.ts";
import type { ChannelPage } from "./channel.ts";
import { parseSearchResponse } from "./search.ts";
import type { SearchPage } from "./search.ts";
import { defaultFilters, encodeChannelSearchParams, encodeSearchParams } from "./search-params.ts";
import { parseChannelSearchResponse } from "./channel-search.ts";
import type { ChannelResult } from "./channel-search.ts";
import type { SearchFilters } from "./search-params.ts";
import { parseHeatmapMarkers, parseJson3, pickPlayerCaptionTrack } from "./transcript.ts";
import type {
  CaptionedPlayerResponse,
  CaptionTrack,
  Cue,
  HeatmapResponse,
  VideoInfo,
} from "./transcript.ts";

// The client identities live next door, in a file with no `obsidian` import, so
// the live smoke test can send the same request this file sends.
export * from "./innertube-context.ts";

/** A request that never reached a parseable response. */
export class InnertubeError extends Error {}

/**
 * One InnerTube POST. `hl`/`gl` are pinned to `en`/`US` here, as everywhere
 * else in this plugin, so a result reads the same on any machine. `safe` sends
 * Restricted Mode, for search and channel browse (GitHub #111).
 */
export async function callInnertube(
  url: string,
  client: keyof typeof CLIENTS,
  body: Record<string, unknown>,
  safe = false,
): Promise<unknown> {
  const { ctx, ua } = CLIENTS[client];
  let response;
  const sentAt = Date.now();
  try {
    // Paced with every other "who is this video" request (GitHub #36).
    response = await governor.run(url === PLAYER_URL ? "player" : "innertube", () =>
      requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": ua },
        body: JSON.stringify({ ...body, context: requestContext(ctx, safe) }),
        // Handled here, so a 4xx reads as a network failure rather than throwing
        // an Obsidian error object at the caller.
        throw: false,
      }),
    );
  } catch (err) {
    throw new InnertubeError(err instanceof Error ? err.message : String(err));
  }

  if (response.status < 200 || response.status >= 300) {
    throw new InnertubeError(`YouTube answered HTTP ${response.status}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text) as unknown;
  } catch {
    throw new InnertubeError("YouTube's response was not JSON.");
  }
  // The bot check arrives as an ordinary 200 with a refusal inside. Seen here,
  // once, it pauses every automatic request (GitHub #31).
  const status = (parsed as { playabilityStatus?: { status?: unknown; reason?: unknown } })?.playabilityStatus;
  if (status && isBotCheckPlayability(status.status, status.reason)) botCheck.trip();
  // A playable answer during a bot-check pause ends it (GitHub #66).
  else if (status?.status === "OK") botCheck.succeeded(sentAt);
  // An age gate, wherever the player call came from, is remembered so the
  // video drops out of every list (GitHub #111).
  if (url === PLAYER_URL && typeof body.videoId === "string" && isAgeGatedAnswer(parsed)) {
    reportAgeRestricted(body.videoId);
  }
  return parsed;
}

/** Answers from the player, one per video and client (GitHub #33). */
const players = new InfoCache<unknown>(() => Date.now(), 20);

/** How long a player answer is worth keeping: its links' life, less a margin. */
function playerKeepUntil(response: unknown, now = Date.now()): number {
  const r = response as { playabilityStatus?: { status?: unknown }; streamingData?: { expiresInSeconds?: unknown } };
  // A refusal or an error page is not an answer worth keeping.
  if (r?.playabilityStatus?.status !== "OK") return now;
  const seconds = Number(r.streamingData?.expiresInSeconds);
  const life = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600_000;
  return now + Math.max(0, life - EXPIRY_SAFETY_MARGIN_MS);
}

/**
 * The player's answer for a video as `client`, asked once and reused until its
 * links expire: 360p, captions, duration and HD all read the same ANDROID
 * answer instead of asking again (GitHub #33). `fresh` skips the kept answer,
 * for a link YouTube has just refused.
 */
export function fetchPlayer(videoId: string, client: keyof typeof CLIENTS, fresh = false): Promise<unknown> {
  const key = `${client}:${videoId}`;
  if (fresh) players.invalidate(key);
  return players.get(key, () => callInnertube(PLAYER_URL, client, playerBody(videoId)), (r) => playerKeepUntil(r));
}

/**
 * Keep player answers on this device across reloads (GitHub #34). Never the
 * vault: the links inside are tied to the network that asked.
 */
export function attachPlayerStore(store: AnswerStore): void {
  players.attachStore(store, trimPlayerAnswer);
}

/** Forget every kept answer for a video (a stream that died is re-resolved). */
export function forgetPlayer(videoId: string): void {
  for (const client of Object.keys(CLIENTS)) players.invalidate(`${client}:${videoId}`);
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
  return parseSearchResponse(await callInnertube(SEARCH_URL, "android", body, true));
}

/**
 * Channels matching a query, for the Add channel sheet (GitHub #108). One
 * request per Enter, first page only. WEB, because ANDROID answers a channel
 * search with unreadable `elementRenderer`s (see `channel-search.ts`).
 */
export async function searchChannels(query: string): Promise<ChannelResult[]> {
  const body = { query, params: encodeChannelSearchParams() };
  return parseChannelSearchResponse(await callInnertube(SEARCH_URL, "web", body));
}

/**
 * One page of a channel's catalogue: its Videos tab, a search inside it, or the
 * next page of either. Issue 045.
 *
 * WEB, not ANDROID: ANDROID answers a channel `browse` with HTTP 400 (measured
 * 2026-10-13). A continuation needs only its token, the same as search.
 */
export async function browseChannel(
  channel: { channelId: string; channelTitle: string },
  query: string | null = null,
  continuation: string | null = null,
): Promise<ChannelPage> {
  const body = continuation
    ? { continuation }
    : query
      ? { browseId: channel.channelId, params: CHANNEL_SEARCH_PARAMS, query }
      : { browseId: channel.channelId, params: CHANNEL_VIDEOS_PARAMS };
  return parseChannelResponse(await callInnertube(BROWSE_URL, "web", body, true), channel);
}

/** What one player call is worth to the hub: the two facts a feed lacks. */
export interface VideoDetails {
  description: string;
  /** Seconds, or null when the video would not answer. */
  durationSeconds: number | null;
  /** The uploader, for "open this video's channel" from a note. "" when unknown. */
  channelId: string;
  channelTitle: string;
  /** The video's title, for a link opened with no hub item behind it. "" when unknown. */
  title: string;
  /**
   * YouTube answered at all (any playability status), so the age check of a
   * feed item is done. False on a network failure or a bot-check pause: ask
   * again later (GitHub #111).
   */
  answered: boolean;
  /** The answer was an age or content gate (GitHub #111). */
  ageRestricted: boolean;
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
    const response = await fetchPlayer(videoId, "android");
    const playability = (response as { playabilityStatus?: { status?: unknown; reason?: unknown } })
      ?.playabilityStatus;
    // A bot check is no answer about the video itself: ask again later.
    const answered =
      typeof playability?.status === "string" && !isBotCheckPlayability(playability.status, playability.reason);
    const details = (response as {
      videoDetails?: {
        shortDescription?: unknown;
        lengthSeconds?: unknown;
        channelId?: unknown;
        author?: unknown;
        title?: unknown;
      };
    }).videoDetails;
    // `lengthSeconds` is a *string* of digits in every player response measured.
    const length = Number(details?.lengthSeconds);
    return {
      description: typeof details?.shortDescription === "string" ? details.shortDescription : "",
      durationSeconds: Number.isFinite(length) && length > 0 ? length : null,
      channelId: typeof details?.channelId === "string" ? details.channelId : "",
      channelTitle: typeof details?.author === "string" ? details.author : "",
      title: typeof details?.title === "string" ? details.title : "",
      answered,
      ageRestricted: isAgeGatedAnswer(response),
    };
  } catch {
    return {
      description: "",
      durationSeconds: null,
      channelId: "",
      channelTitle: "",
      title: "",
      answered: false,
      ageRestricted: false,
    };
  }
}

/**
 * A video's publish date, as an ISO string, or "" when YouTube would not say.
 *
 * WEB, because only the WEB player carries `microformat`. One call per video,
 * and only the backfill (048) makes it — a path that runs a few times a year.
 */
export async function fetchPublishDate(videoId: string): Promise<string> {
  try {
    return parsePlayerPublishDate(await fetchPlayer(videoId, "web"));
  } catch {
    return "";
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
  const response = await fetchPlayer(videoId, "android");
  return pickPlayerCaptionTrack(response as CaptionedPlayerResponse, language);
}

/**
 * The cues of a video's transcript, in one call.
 *
 * `fetchCaptionTrack` plus the fetch of the signed URL it hands back, which is
 * two steps every caller was doing for itself. Answers `[]` rather than
 * throwing when there are no captions in that language, because "this video has
 * no transcript" is a thing to show, not an error to report.
 */
export async function fetchTranscriptCues(videoId: string, language: string): Promise<Cue[]> {
  const track = await fetchCaptionTrack(videoId, language);
  if (!track) return [];
  governor.count("captions");
  const response = await requestUrl({ url: track.url, throw: true });
  return parseJson3(response.text);
}

/**
 * The replay heatmap for a video, without yt-dlp.
 *
 * The `next` endpoint on the WEB client, which is the only combination that
 * answers with one — see `CLIENTS`. It is a 1 MB response for a hundred
 * numbers, which sounds indefensible and is not: gzipped it is **67 KB on the
 * wire**, measured, and it is fetched once per note rather than once per view.
 * That is the number to judge it by on a phone.
 *
 * Answers `[]` for a video with no heatmap — most videos have none — so the
 * caller has one shape to handle rather than three.
 */
export async function fetchHeatmap(videoId: string): Promise<VideoInfo["heatmap"]> {
  const response = await callInnertube(NEXT_URL, "web", { videoId });
  return parseHeatmapMarkers(response as HeatmapResponse);
}
