/**
 * Who this plugin says it is when it talks to InnerTube, and where it talks.
 *
 * Split out of `innertube.ts` — which imports `obsidian` and therefore cannot
 * be loaded outside the app — so the live smoke test can send the *same*
 * request the plugin sends rather than a copy of it that drifts. A client
 * context that has quietly diverged from the one the fixtures were recorded
 * under is exactly the failure a smoke test exists to catch.
 */

export const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
export const SEARCH_URL = "https://www.youtube.com/youtubei/v1/search";

export interface ClientProfile {
  ctx: Record<string, string | number>;
  /** Part of the identity, not decoration: the wrong UA gets a different answer. */
  ua: string;
}

/**
 * ANDROID carries the muxed format on every video measured, and answers search
 * with no auth and no API key. IOS is only consulted for its HLS manifest,
 * which showed up on 1 of 10 videos and is treated as a bonus rather than a
 * path worth designing for.
 */
export const CLIENTS: Record<"android" | "ios", ClientProfile> = {
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

export function playerBody(videoId: string): Record<string, unknown> {
  return { videoId, contentCheckOk: true, racyCheckOk: true };
}
