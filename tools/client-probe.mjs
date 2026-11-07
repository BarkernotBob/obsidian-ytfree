/**
 * Which way of getting HD actually serves a whole video, measured outside the app.
 *
 *   node tools/client-probe.mjs [videoId ...]
 *
 * For each InnerTube client with direct URLs, and for yt-dlp when it is
 * installed: the best H.264 picture file at or below 1080p, and one small byte
 * range read at 0s, 30s, 60s, 90s and 180s into it. A client whose reads stop
 * working after the first minute is the "serves only the opening" failure
 * (no anti-bot token); a client that serves all five can carry HD.
 */
import { execFileSync } from "node:child_process";

const ids = process.argv.slice(2);
if (!ids.length) ids.push("dQw4w9WgXcQ", "aqz-KE-bpKQ");

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";

const CLIENTS = {
  ANDROID: {
    ctx: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, osName: "Android", osVersion: "14" },
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
  },
  IOS: {
    ctx: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
  ANDROID_VR: {
    ctx: {
      clientName: "ANDROID_VR",
      clientVersion: "1.62.27",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
    },
    ua: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  },
  VISIONOS: {
    ctx: { clientName: "VISIONOS", clientVersion: "0.1", deviceMake: "Apple", deviceModel: "RealityDevice14,1", osName: "visionOS", osVersion: "1.3.21O771" },
    ua: "Mozilla/5.0 (iPad; CPU OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

const AT = [0, 30, 60, 90, 180];

const withRange = (url, start, end) => `${url}${url.includes("?") ? "&" : "?"}range=${start}-${end}`;

async function read(url, start, ua) {
  try {
    const res = await fetch(withRange(url, start, start + 1023), { headers: ua ? { "User-Agent": ua } : {} });
    if (res.ok) await res.arrayBuffer();
    return res.status;
  } catch (err) {
    return `ERR ${err.message}`;
  }
}

/** Approximate byte offset for `t` seconds: proportional to the file length. */
async function readsAcross(url, contentLength, durationSec, ua) {
  const out = [];
  for (const t of AT) {
    if (t >= durationSec) continue;
    const start = Math.floor((contentLength * t) / durationSec);
    out.push(`${t}s:${await read(url, start, ua)}`);
  }
  return out.join(" ");
}

function bestAvc(formats) {
  return formats
    .filter((f) => (f.mimeType ?? "").startsWith("video/mp4") && /avc1/.test(f.mimeType) && (f.height ?? 0) <= 1080)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}

for (const id of ids) {
  console.log(`\n=== ${id}`);
  for (const [name, { ctx, ua }] of Object.entries(CLIENTS)) {
    try {
      const res = await fetch(PLAYER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": ua },
        body: JSON.stringify({ videoId: id, contentCheckOk: true, racyCheckOk: true, context: { client: { ...ctx, hl: "en", gl: "US" } } }),
      });
      const json = await res.json();
      const status = json.playabilityStatus?.status;
      if (status !== "OK") {
        console.log(`${name}: ${status ?? res.status} ${json.playabilityStatus?.reason ?? ""}`);
        continue;
      }
      const formats = json.streamingData?.adaptiveFormats ?? [];
      const v = bestAvc(formats);
      if (!v) {
        console.log(`${name}: OK but no H.264 adaptive format (${formats.length} adaptive)`);
        continue;
      }
      if (!v.url) {
        console.log(`${name}: ${v.height}p only as a ciphered URL (needs the JS player)`);
        continue;
      }
      const dur = Number(json.videoDetails?.lengthSeconds ?? 0);
      console.log(`${name}: ${v.height}p itag ${v.itag} — ${await readsAcross(v.url, Number(v.contentLength), dur, ua)}`);
    } catch (err) {
      console.log(`${name}: ERR ${err.message}`);
    }
  }

  // yt-dlp, with its own default client set, when it is installed.
  for (const bin of ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"]) {
    try {
      const out = execFileSync(
        bin,
        ["-f", "bv*[vcodec^=avc1][height<=1080]", "--print", "%(height)s %(duration)s %(filesize,filesize_approx)s", "--print", "urls", `https://www.youtube.com/watch?v=${id}`],
        { encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] },
      ).trim().split("\n");
      const [height, dur, size] = out[0].split(" ");
      const url = out[out.length - 1];
      console.log(`yt-dlp (${bin}): ${height}p — ${await readsAcross(url, Number(size), Number(dur))}`);
      break;
    } catch (err) {
      if (err.code === "ENOENT") continue;
      console.log(`yt-dlp (${bin}): ERR ${(err.stderr || err.message || "").toString().split("\n").filter(Boolean).slice(-1)[0]}`);
      break;
    }
  }
}
