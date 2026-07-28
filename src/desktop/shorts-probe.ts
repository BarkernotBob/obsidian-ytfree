/**
 * The Shorts probe. Desktop only, and not because of any policy — the answer
 * *is* an HTTP redirect, and there is no way to see one on mobile:
 * `requestUrl` follows redirects, and a `fetch` from `capacitor://localhost`
 * to youtube.com is blocked by CORS before it ever returns a status.
 *
 * Mobile therefore leaves `isShort` as null, which the design already defines
 * as "ask again later" rather than "long-form". The next desktop poll fills it
 * in. Nothing is misclassified in the meantime; unprobed items simply show.
 */

import { request as httpsRequest } from "https";
import { shortsProbeUrl } from "../subscriptions.ts";

/**
 * Ask YouTube whether a video is a Short, without downloading it.
 *
 * `/shorts/<id>` answers 200 for a Short and 303 (redirecting to `/watch`) for
 * long-form. It is the only field-free way to tell them apart: the feed mixes
 * both and marks neither.
 *
 * Any other status returns null, meaning "ask again later" rather than
 * "long-form". A nonexistent ID also answers 200 — measured — so guessing from
 * an unexpected status would hide real videos.
 */
export function probeIsShort(videoId: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      shortsProbeUrl(videoId),
      { method: "GET", headers: { "user-agent": "Mozilla/5.0" } },
      (res) => {
        res.destroy();
        if (res.statusCode === 200) resolve(true);
        else if (res.statusCode === 303 || res.statusCode === 302) resolve(false);
        else resolve(null);
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}
