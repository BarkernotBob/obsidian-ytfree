#!/usr/bin/env node
/**
 * Record InnerTube player responses as test fixtures.
 *
 * The parser in `src/mobile/player-response.ts` is tested against real captured
 * JSON rather than JSON I made up, because the whole risk in that file is
 * YouTube's shape changing — and a hand-written fixture can only ever confirm
 * my own idea of the shape.
 *
 *   node spikes/innertube/record.mjs
 *
 * Writes into tests/fixtures/. Re-run it when a fixture starts looking stale;
 * the diff is the interesting part.
 *
 * Two things are done to the captured JSON before it lands:
 *   - it is trimmed to the fields the parser reads, so the fixtures stay
 *     readable and a diff is legible;
 *   - the `ip=` parameter is redacted out of every stream URL, because that is
 *     the recording machine's public IP and these files go into git.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const CLIENTS = {
  ANDROID: {
    ctx: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14",
    },
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
  },
  IOS: {
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

const OUT_DIR = join(process.cwd(), "tests", "fixtures");

const TARGETS = [
  // Ordinary long-form video: the everyday case, itag 18 present.
  { file: "player-android-ok.json", videoId: "vS6HEes8daw", client: "ANDROID" },
  // The one video in the probe set that carries an HLS manifest, captured from
  // the IOS client — this is the fallback path when itag 18 is missing.
  { file: "player-ios-hls.json", videoId: "dQw4w9WgXcQ", client: "IOS" },
  // Age-restricted: LOGIN_REQUIRED, which is also what a bot check looks like.
  { file: "player-login-required.json", videoId: "HtVdAasjOgU", client: "ANDROID" },
  // Removed/private video: ERROR, and no streamingData at all.
  { file: "player-unavailable.json", videoId: "T4kFTaEDsqk", client: "ANDROID" },
];

/**
 * Googlevideo spells parameters two ways — `?ip=1.2.3.4` on progressive URLs
 * and `/ip/1.2.3.4/` on manifest URLs — and both carry the recording machine's
 * public IP. Both have to go.
 */
function redact(url) {
  if (typeof url !== "string") return url;
  return url.replace(/([?&]ip=)[^&]*/g, "$1REDACTED").replace(/\/ip\/[^/]+/g, "/ip/REDACTED");
}

/** Keep only what the parser reads, plus one adaptive format for context. */
function trim(response) {
  const streaming = response.streamingData ?? {};
  const formats = (streaming.formats ?? []).map((f) => ({
    itag: f.itag,
    mimeType: f.mimeType,
    qualityLabel: f.qualityLabel,
    ...(f.url ? { url: redact(f.url) } : {}),
    ...(f.signatureCipher ? { signatureCipher: "<present>" } : {}),
  }));
  const adaptive = (streaming.adaptiveFormats ?? []).slice(0, 1).map((f) => ({
    itag: f.itag,
    mimeType: f.mimeType,
    qualityLabel: f.qualityLabel,
    ...(f.url ? { url: redact(f.url) } : {}),
  }));

  return {
    playabilityStatus: {
      status: response.playabilityStatus?.status,
      ...(response.playabilityStatus?.reason
        ? { reason: response.playabilityStatus.reason }
        : {}),
    },
    ...(streaming.formats || streaming.adaptiveFormats || streaming.hlsManifestUrl
      ? {
          streamingData: {
            ...(formats.length ? { formats } : {}),
            ...(adaptive.length ? { adaptiveFormats: adaptive } : {}),
            ...(streaming.hlsManifestUrl
              ? { hlsManifestUrl: redact(streaming.hlsManifestUrl) }
              : {}),
          },
        }
      : {}),
    videoDetails: { title: response.videoDetails?.title },
  };
}

async function callPlayer(videoId, client) {
  const { ctx, ua } = CLIENTS[client];
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({
      videoId,
      context: { client: { ...ctx, hl: "en", gl: "US" } },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

await mkdir(OUT_DIR, { recursive: true });

for (const { file, videoId, client } of TARGETS) {
  try {
    const raw = await callPlayer(videoId, client);
    const status = raw.playabilityStatus?.status;
    await writeFile(join(OUT_DIR, file), JSON.stringify(trim(raw), null, 2) + "\n");
    console.log(`${file}  ${videoId}  ${client}  status=${status}`);
  } catch (err) {
    console.error(`${file}  ${videoId}  ${client}  FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}
