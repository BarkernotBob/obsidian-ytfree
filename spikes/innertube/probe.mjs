#!/usr/bin/env node
/**
 * Probe — does InnerTube still hand out playable, unciphered stream URLs?
 *
 * Issues 004 and 005 both rest on that one fact, and it is YouTube's to revoke.
 * Run this before writing any code in the next session; it takes a few seconds
 * and tells you whether the plan is still real.
 *
 *   node spikes/innertube/probe.mjs                 # the 10-video default set
 *   node spikes/innertube/probe.mjs dQw4w9WgXcQ     # specific ids
 *
 * No dependencies, no build step, nothing here ships in the plugin.
 *
 * A green run means: playabilityStatus OK, zero ciphered formats, itag 18
 * present, and the itag 18 URL actually serves bytes. Any of those going red
 * changes the plan, so the failure line says which one it was.
 */

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

const DEFAULT_IDS = [
  "dQw4w9WgXcQ",
  "h0EGCnBjTVk",
  "jNQXAC9IVRw",
  "9bZkp7q19f0",
  "kJQP7kiw5Fk",
  "M7lc1UVf-VE",
  "aqz-KE-bpKQ",
  "YQHsXMglC9A",
  "fJ9rUzIMcZQ",
  "5NV6Rdv1a3I",
];

async function player(videoId, clientName) {
  const { ctx, ua } = CLIENTS[clientName];
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
  return res.json();
}

/** Do bytes actually come back? A URL we cannot read is not a resolved stream. */
async function servesBytes(url) {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-99" } });
    return res.status === 206 || res.status === 200;
  } catch {
    return false;
  }
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_IDS;
let failures = 0;

for (const id of ids) {
  const android = await player(id, "ANDROID");
  const status = android?.playabilityStatus?.status;
  const sd = android?.streamingData ?? {};
  const all = [...(sd.formats ?? []), ...(sd.adaptiveFormats ?? [])];
  const ciphered = all.filter((f) => f.signatureCipher || f.cipher).length;
  const muxed = (sd.formats ?? []).find((f) => f.itag === 18 && f.url);
  const maxHeight = Math.max(0, ...all.map((f) => f.height ?? 0));

  const ios = await player(id, "IOS");
  const hls = Boolean(ios?.streamingData?.hlsManifestUrl);

  const bytes = muxed ? await servesBytes(muxed.url) : false;
  const ok = status === "OK" && ciphered === 0 && Boolean(muxed) && bytes;
  if (!ok) failures++;

  const title = (android?.videoDetails?.title ?? "").slice(0, 30);
  console.log(
    `${ok ? "PASS" : "FAIL"} ${id}  status=${status}  ciphered=${ciphered}  ` +
      `itag18=${muxed ? "yes" : "NO"}  bytes=${bytes ? "yes" : "NO"}  ` +
      `maxAdaptive=${maxHeight}p  iosHls=${hls ? "yes" : "no"}  ${title}`,
  );
  if (!ok) {
    if (status !== "OK") console.log(`     reason: ${android?.playabilityStatus?.reason}`);
    if (ciphered > 0) console.log("     ciphered formats appeared — 004/005 need rethinking");
    if (!muxed) console.log("     no itag 18 — the 360p v1 path is gone");
    else if (!bytes) console.log("     itag 18 URL refused bytes — attestation may now be required");
  }
}

console.log(`\n${ids.length - failures}/${ids.length} playable and unciphered.`);
process.exit(failures ? 1 : 0);
