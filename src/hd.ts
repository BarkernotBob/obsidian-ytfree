/**
 * HD through InnerTube, for desktop and phone alike: the app-side half of
 * `adaptive.ts`, which owns everything that can be tested without the app.
 * This file is only the two kinds of request — the player call per client,
 * and a byte range of a googlevideo file — both through `requestUrl`. Desktop
 * swaps the byte ranges for a streaming, cancellable request
 * (`desktop/range-fetch.ts`) that falls back to this one.
 */

import { requestUrl } from "obsidian";
import { botCheck } from "./bot-check.ts";
import { DEFAULT_MAX_HEIGHT, refusal, resolveHd, resolveHdFromYtDlp, withRange } from "./adaptive.ts";
import type { AdaptiveFormat, ClientAnswer, FetchRange, YtDlpFormat } from "./adaptive.ts";
import { CLIENTS, fetchPlayer } from "./innertube.ts";
import type { ResolvedStream } from "./stream.ts";

/** ANDROID first: it is the client the 360p path already depends on. */
const HD_CLIENTS: (keyof typeof CLIENTS)[] = ["android", "ios"];

interface HdPlayerResponse {
  playabilityStatus?: { status?: string };
  streamingData?: { adaptiveFormats?: AdaptiveFormat[]; hlsManifestUrl?: string };
}

async function ask(videoId: string, client: string, fresh = false): Promise<ClientAnswer | null> {
  // HD is automatic work: once one client meets the bot check, the next is
  // not asked (GitHub #31).
  botCheck.guard();
  const name = client as keyof typeof CLIENTS;
  // The same answer 360p already read, when it is still good (GitHub #33). A
  // re-link after a refusal asks fresh: the kept links are the refused ones.
  const response = (await fetchPlayer(videoId, name, fresh)) as HdPlayerResponse;
  if (response.playabilityStatus?.status !== "OK") return null;
  return {
    adaptiveFormats: response.streamingData?.adaptiveFormats ?? [],
    hlsManifestUrl: response.streamingData?.hlsManifestUrl ?? null,
    ua: CLIENTS[name].ua,
  };
}

/**
 * A byte range, as an ArrayBuffer. Throws with `status` on a refusal.
 * `requestUrl` can be neither cancelled nor watched, so the loader's `io` is
 * ignored here: a cancelled request runs to the end and its answer is dropped.
 */
export const fetchRange: FetchRange = async (url, start, end, ua) => {
  const response = await requestUrl({
    url: withRange(url, start, end),
    headers: ua ? { "User-Agent": ua } : {},
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) throw refusal(response.status);
  return response.arrayBuffer;
};

export function resolveHdStream(
  videoId: string,
  maxHeight = DEFAULT_MAX_HEIGHT,
  fetch: FetchRange = fetchRange,
): Promise<ResolvedStream> {
  return resolveHd(videoId, HD_CLIENTS, (client) => ask(videoId, client), fetch, maxHeight, false, (client) =>
    ask(videoId, client, true),
  );
}

/**
 * The phone (#25): IOS first, and its HLS manifest the moment it has one. That
 * manifest serves the whole video and iOS plays it natively; the separate
 * files stop at about a minute on most videos, so they are only the fallback.
 */
export function resolvePhoneHdStream(videoId: string, maxHeight = DEFAULT_MAX_HEIGHT): Promise<ResolvedStream> {
  return resolveHd(videoId, ["ios", "android"], (client) => ask(videoId, client), fetchRange, maxHeight, true, (client) =>
    ask(videoId, client, true),
  );
}

/** Desktop: the same stitched stream from yt-dlp's files (see `YtDlpFormat`). */
export function resolveHdFromYtDlpFormats(
  videoId: string,
  formats: YtDlpFormat[],
  maxHeight = DEFAULT_MAX_HEIGHT,
  fetch: FetchRange = fetchRange,
): Promise<ResolvedStream> {
  return resolveHdFromYtDlp(videoId, formats, fetch, maxHeight);
}
