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
/** The watch page's data, and the only place the replay heatmap exists. */
export const NEXT_URL = "https://www.youtube.com/youtubei/v1/next";

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
 *
 * WEB is consulted for exactly one thing — the replay heatmap — because it is
 * the only client that answers with one. Measured on the `next` endpoint:
 * WEB 1.0 MB with 100 markers, ANDROID 13 MB and IOS 11 MB with the same 100,
 * and MWEB, TVHTML5, ANDROID_VR and WEB_EMBEDDED_PLAYER with none at all. So
 * the client that carries it is also the cheapest one that could.
 */
export const CLIENTS: Record<"android" | "ios" | "web", ClientProfile> = {
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
  web: {
    ctx: { clientName: "WEB", clientVersion: "2.20250101.00.00" },
    // A desktop browser's, on the phone too: this identity is the reason the
    // response carries a heatmap, and pairing it with an iPhone UA is how you
    // get MWEB's answer instead — which has none.
    ua:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36",
  },
};

export function playerBody(videoId: string): Record<string, unknown> {
  return { videoId, contentCheckOk: true, racyCheckOk: true };
}
