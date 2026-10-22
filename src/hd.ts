/**
 * HD through InnerTube, for desktop and phone alike: the app-side half of
 * `adaptive.ts`, which owns everything that can be tested without the app.
 * This file is only the two kinds of request — the player call per client,
 * and a byte range of a googlevideo file — both through `requestUrl`. Desktop
 * swaps the byte ranges for a streaming, cancellable request
 * (`desktop/range-fetch.ts`) that falls back to this one.
 */

import { requestUrl } from "obsidian";
import { DEFAULT_MAX_HEIGHT, resolveHd, withRange } from "./adaptive.ts";
import type { AdaptiveFormat, ClientAnswer, FetchRange } from "./adaptive.ts";
import { callInnertube, CLIENTS, playerBody, PLAYER_URL } from "./innertube.ts";
import type { ResolvedStream } from "./stream.ts";

/** ANDROID first: it is the client the 360p path already depends on. */
const HD_CLIENTS: (keyof typeof CLIENTS)[] = ["android", "ios"];

interface HdPlayerResponse {
  playabilityStatus?: { status?: string };
  streamingData?: { adaptiveFormats?: AdaptiveFormat[]; hlsManifestUrl?: string };
}

async function ask(videoId: string, client: string): Promise<ClientAnswer | null> {
  const name = client as keyof typeof CLIENTS;
  const response = (await callInnertube(PLAYER_URL, name, playerBody(videoId))) as HdPlayerResponse;
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
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(`googlevideo answered HTTP ${response.status}`) as Error & { status: number };
    err.status = response.status;
    throw err;
  }
  return response.arrayBuffer;
};

export function resolveHdStream(
  videoId: string,
  maxHeight = DEFAULT_MAX_HEIGHT,
  fetch: FetchRange = fetchRange,
): Promise<ResolvedStream> {
  return resolveHd(videoId, HD_CLIENTS, (client) => ask(videoId, client), fetch, maxHeight);
}
