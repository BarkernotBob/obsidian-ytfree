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

import { requestUrl } from "obsidian";
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

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";

interface ClientProfile {
  ctx: Record<string, string | number>;
  ua: string;
}

/**
 * Two clients, asked in order. ANDROID carries the muxed format on every video
 * measured; IOS is only consulted for its HLS manifest, which showed up on 1 of
 * 10 videos and is treated as a bonus rather than a path worth designing for.
 */
const CLIENTS: Record<"android" | "ios", ClientProfile> = {
  android: {
    ctx: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14",
    },
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
  },
  ios: {
    ctx: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
    },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
};

// ---------------------------------------------------------------- the request

/**
 * `requestUrl` rather than `fetch`, and this is not a preference: the webview
 * origin is `capacitor://localhost` and youtube.com sends no
 * `Access-Control-Allow-Origin`, so a plain `fetch` is refused before it is
 * sent. `requestUrl` goes through the native layer, which has no CORS and
 * accepts the custom User-Agent the client context has to be paired with.
 */
async function callPlayer(videoId: string, client: keyof typeof CLIENTS): Promise<PlayerResponse> {
  const { ctx, ua } = CLIENTS[client];
  let response;
  try {
    response = await requestUrl({
      url: PLAYER_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ua,
      },
      body: JSON.stringify({
        videoId,
        context: { client: { ...ctx, hl: "en", gl: "US" } },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      // Handled here, so a 4xx reads as a network failure rather than throwing
      // an Obsidian error object at the caller.
      throw: false,
    });
  } catch (err) {
    throw new MobileResolveError("network", err instanceof Error ? err.message : String(err));
  }

  if (response.status < 200 || response.status >= 300) {
    throw new MobileResolveError("network", `YouTube answered HTTP ${response.status}.`);
  }

  try {
    return JSON.parse(response.text) as PlayerResponse;
  } catch {
    throw new MobileResolveError("network", "YouTube's response was not JSON.");
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
