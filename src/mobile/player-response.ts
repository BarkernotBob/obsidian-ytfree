/**
 * Pure reading of YouTube's InnerTube player response.
 *
 * Split out from `innertube.ts` for one reason: that file imports `obsidian`
 * for `requestUrl`, and `obsidian` only exists inside the app. Everything here
 * is a function from JSON to an answer, so keeping it in its own module lets
 * the tests run it against recorded fixtures under plain `node --test` — which
 * matters more than usual, because the shape of this JSON is the thing most
 * likely to change out from under the plugin.
 *
 * Nothing here may import `obsidian` or a Node builtin.
 */

import { EXPIRY_SAFETY_MARGIN_MS, parseExpiry } from "../stream.ts";
import type { ResolvedStream } from "../stream.ts";

/**
 * The muxed 360p format — video and audio in one file, and therefore the only
 * thing a bare `<video>` can play. YouTube's old 720p progressive format (itag
 * 22) is effectively gone; everything above 360p arrives as separate video and
 * audio streams and needs MSE, which is issue 005.
 */
export const MUXED_ITAG = 18;

/** The slice of the player response we read. Everything else is ignored. */
export interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: {
    formats?: InnerTubeFormat[];
    adaptiveFormats?: InnerTubeFormat[];
    hlsManifestUrl?: string;
  };
  videoDetails?: { title?: string };
}

export interface InnerTubeFormat {
  itag?: number;
  url?: string;
  /** Present when the URL needs `base.js` to descramble. Measured: never. */
  signatureCipher?: string;
  cipher?: string;
}

/**
 * Why a resolve failed, in the terms the user needs.
 *
 * The kind is not decoration: the fallback notice has to say which failure it
 * was, because "age-restricted" and "YouTube changed something" call for
 * completely different reactions and both otherwise look like a dead player.
 */
export type FailureKind = "login" | "unplayable" | "no-format" | "network";

export class MobileResolveError extends Error {
  // Written out longhand rather than as a constructor parameter property,
  // because `node --test` strips types instead of compiling them and cannot
  // handle the shorthand.
  readonly kind: FailureKind;

  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = "MobileResolveError";
    this.kind = kind;
  }
}

/**
 * The playability problem, or null when the video can be played.
 *
 * `LOGIN_REQUIRED` covers age-restricted and members-only videos, which do not
 * resolve on desktop without cookies either, and it is also what a bot check
 * looks like. Either way the honest answer is "open it in YouTube".
 */
export function playabilityFailure(response: PlayerResponse): MobileResolveError | null {
  const status = response.playabilityStatus?.status;
  const reason = response.playabilityStatus?.reason?.trim();

  if (!status) {
    return new MobileResolveError("unplayable", "YouTube sent no playability status.");
  }
  if (status === "OK") return null;
  if (status === "LOGIN_REQUIRED") {
    return new MobileResolveError(
      "login",
      reason || "This video needs a signed-in account (age-restricted or members-only).",
    );
  }
  return new MobileResolveError("unplayable", reason || status);
}

/**
 * The one format a bare `<video>` can play, or null.
 *
 * A format carrying `signatureCipher` instead of `url` is deliberately not
 * unwrapped: descrambling it means running YouTube's `base.js` inside the
 * vault, which is exactly the cost this whole approach exists to avoid. If
 * those start appearing, the right answer is to notice and rethink, not to
 * quietly grow a crypto layer.
 */
export function pickMuxedFormat(response: PlayerResponse): string | null {
  const formats = response.streamingData?.formats ?? [];
  const muxed = formats.find((f) => f.itag === MUXED_ITAG && f.url);
  return muxed?.url ?? null;
}

export function hlsManifest(response: PlayerResponse): string | null {
  return response.streamingData?.hlsManifestUrl ?? null;
}

/** Wrap a resolved URL in the shape the player already understands. */
export function toStream(url: string, isHls: boolean): ResolvedStream {
  return {
    url,
    isHls,
    // Always "fast": 360p is the whole of what this resolver can reach.
    mode: "fast",
    expiresAt: parseExpiry(url) - EXPIRY_SAFETY_MARGIN_MS,
  };
}
