/**
 * The mobile resolver: YouTube's own InnerTube player endpoint, standing in for
 * yt-dlp.
 *
 * There is no yt-dlp and no Node on iOS, and the embedded player is not an
 * option either — Obsidian iOS runs at `capacitor://localhost`, which is not an
 * http(s) origin, so a framed player refuses to configure itself (error 153,
 * measured on eight parameter variants). What is left is to resolve a stream
 * URL ourselves and hand it to a plain `<video>`, which is what desktop already
 * does.
 *
 * The reason that is cheap rather than "reimplement yt-dlp": the mobile client
 * contexts get back formats with a plain `url` field. Measured 2026-07-27 over
 * ten videos — zero of twenty-seven formats needed signature descrambling, and
 * the URLs served bytes with no PO token. No `base.js`, no `eval`, no crypto.
 * Re-check with `spikes/innertube/probe.mjs`; if that goes red, this file is
 * what has to change.
 *
 * Everything below the fetch is a pure function over the JSON, and lives in
 * `player-response.ts` so it can be tested against recorded fixtures without
 * the app around it. This file is only the request.
 */

import { callInnertube, CLIENTS, playerBody, PLAYER_URL } from "../innertube.ts";
import type { ResolvedStream } from "../stream.ts";
import {
  hlsManifest,
  MobileResolveError,
  pickMuxedFormat,
  playabilityFailure,
  toStream,
} from "./player-response.ts";
import type { PlayerResponse } from "./player-response.ts";

export * from "./player-response.ts";

// ---------------------------------------------------------------- the request

/**
 * The client identities and the POST itself live in `../innertube.ts`, shared
 * with search — the player is not the only thing that speaks this protocol any
 * more. All this adds is the resolver's own error type, so a caller here sees
 * one failure vocabulary rather than two.
 */
async function callPlayer(videoId: string, client: keyof typeof CLIENTS): Promise<PlayerResponse> {
  try {
    return (await callInnertube(PLAYER_URL, client, playerBody(videoId))) as PlayerResponse;
  } catch (err) {
    throw new MobileResolveError("network", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Resolve a video to something a `<video>` element can play, on a device with
 * no yt-dlp.
 *
 * Never cache the result into a note or into frontmatter. Googlevideo URLs are
 * IP-locked as well as time-limited, so a URL resolved on the Mac and synced
 * through the vault would 403 the moment the phone is on cellular. Resolution
 * has to happen on the device that plays.
 */
export async function resolveMobileStream(videoId: string): Promise<ResolvedStream> {
  const android = await callPlayer(videoId, "android");

  const problem = playabilityFailure(android);
  if (problem) throw problem;

  const muxed = pickMuxedFormat(android);
  if (muxed) return toStream(muxed, false);

  // No itag 18 is rare enough that it is worth one more round trip before
  // giving up: iOS HLS is free 1080p when it exists, and iOS plays it natively.
  const ios = await callPlayer(videoId, "ios");
  const hls = hlsManifest(ios);
  if (hls) return toStream(hls, true);

  throw new MobileResolveError(
    "no-format",
    "YouTube offered no single-file format for this video.",
  );
}
