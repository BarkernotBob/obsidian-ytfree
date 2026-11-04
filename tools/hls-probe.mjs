/**
 * Phone HD (GitHub #25): which InnerTube client hands back an HLS manifest
 * whose HD segments serve the *whole* video, signed out and with no PO token.
 *
 *   node tools/hls-probe.mjs [videoId ...]
 *
 * For each client: is there an `hlsManifestUrl`, which heights and codecs the
 * master lists, and for the best H.264 variant at or below 1080p, the status
 * and size of the segment at 0s, 60s, 90s, 180s and near the end. Segments are
 * fetched with a phone Safari / AVPlayer User-Agent, because that is who will
 * fetch them on the iPhone. It also prints the CORS header on the master and a
 * segment when asked from `capacitor://localhost` — hls.js on the phone needs
 * it, native playback does not.
 */

const ids = process.argv.slice(2);
if (!ids.length) ids.push("aqz-KE-bpKQ", "dQw4w9WgXcQ", "9bZkp7q19f0", "LXb3EKWsInQ", "8jPQjjsBbIc");

const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15,gzip(gfe)";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1";
const AVPLAYER = "AppleCoreMedia/1.0.0.22D82 (iPhone; U; CPU OS 18_3_2 like Mac OS X; en_us)";

const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)";

// Versions as in yt-dlp 2026.08.19's client table (read 2026-11-04).
// `visitor: true` sends the visitorData a plain youtube.com page load hands out.
const CLIENTS = {
  IOS_OLD: {
    ctx: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    extra: { "X-YouTube-Client-Name": "5", "X-YouTube-Client-Version": "20.10.4" },
  },
  IOS: {
    ctx: { clientName: "IOS", clientVersion: "21.26.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" },
    ua: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    extra: { "X-YouTube-Client-Name": "5", "X-YouTube-Client-Version": "21.26.4" },
    visitor: true,
  },
  VISIONOS: {
    ctx: { clientName: "VISIONOS", clientVersion: "1.02", deviceMake: "Apple", deviceModel: "RealityDevice17,1", osName: "visionOS", osVersion: "26.5.23O471" },
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    extra: { "X-YouTube-Client-Name": "101", "X-YouTube-Client-Version": "1.02" },
    visitor: true,
  },
  WEB_SAFARI: {
    ctx: { clientName: "WEB", clientVersion: "2.20260708.00.00" },
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)",
    extra: { "X-YouTube-Client-Name": "1", "X-YouTube-Client-Version": "2.20260708.00.00", Origin: "https://www.youtube.com" },
    visitor: true,
  },
  MWEB: {
    ctx: { clientName: "MWEB", clientVersion: "2.20260708.05.00" },
    ua: IPAD_SAFARI,
    extra: { "X-YouTube-Client-Name": "2", "X-YouTube-Client-Version": "2.20260708.05.00", Origin: "https://m.youtube.com" },
    visitor: true,
  },
  ANDROID_VR: {
    ctx: {
      clientName: "ANDROID_VR", clientVersion: "1.65.10", deviceMake: "Oculus", deviceModel: "Quest 3",
      androidSdkVersion: 32, osName: "Android", osVersion: "12L",
    },
    ua: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    extra: { "X-YouTube-Client-Name": "28", "X-YouTube-Client-Version": "1.65.10" },
    visitor: true,
  },
};

/** The visitorData a signed-out youtube.com page load hands any browser. */
async function visitorData() {
  try {
    const res = await fetch("https://www.youtube.com/", { headers: { "User-Agent": SAFARI_MAC, "Accept-Language": "en-US" } });
    const html = await res.text();
    return /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ?? /"visitorData":"([^"]+)"/.exec(html)?.[1] ?? null;
  } catch {
    return null;
  }
}
const VISITOR = await visitorData();
console.log(`visitorData from youtube.com: ${VISITOR ? "yes" : "no"}`);

/** 1 KB of an adaptive file at 90s, to tell whole-file links from opening-only ones. */
async function deepAdaptive(json, ua) {
  const dur = Number(json.videoDetails?.lengthSeconds ?? 0);
  const v = (json.streamingData?.adaptiveFormats ?? [])
    .filter((f) => /avc1/.test(f.mimeType ?? "") && (f.height ?? 0) <= 1080)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
  if (!v) return "no H.264 adaptive";
  if (!v.url) return `${v.height}p ciphered`;
  if (dur < 100) return `${v.height}p (too short)`;
  const at = Math.floor((Number(v.contentLength) * 90) / dur);
  const sep = v.url.includes("?") ? "&" : "?";
  try {
    const r = await fetch(`${v.url}${sep}range=${at}-${at + 1023}`, { headers: { "User-Agent": ua } });
    return `${v.height}p file @90s: ${r.status}`;
  } catch (err) {
    return `${v.height}p file @90s: ERR`;
  }
}

const AT = [0, 60, 90, 180];

/** Master playlist → variants with height, codecs, bandwidth, uri. */
function variants(master, base) {
  const lines = master.split("\n").map((l) => l.trim());
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const attrs = lines[i];
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(attrs);
    const codecs = /CODECS="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const bw = Number(/BANDWIDTH=(\d+)/.exec(attrs)?.[1] ?? 0);
    const audio = /AUDIO="([^"]+)"/.exec(attrs)?.[1] ?? null;
    const uri = new URL(lines[i + 1], base).href;
    out.push({ height: res ? Number(res[2]) : 0, codecs, bw, audio, uri });
  }
  return out;
}

/** Media playlist → [{t, uri}] with start times. */
function segments(media, base) {
  const lines = media.split("\n").map((l) => l.trim());
  const out = [];
  let t = 0;
  let dur = 0;
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) dur = parseFloat(line.slice(8));
    else if (line && !line.startsWith("#")) {
      out.push({ t, uri: new URL(line, base).href });
      t += dur;
    }
  }
  return out;
}

async function get(url, ua, origin) {
  const t0 = Date.now();
  try {
    const headers = { "User-Agent": ua };
    if (origin) headers.Origin = origin;
    const res = await fetch(url, { headers });
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    return { status: res.status, bytes: buf?.length ?? 0, ms: Date.now() - t0, acao: res.headers.get("access-control-allow-origin"), buf };
  } catch (err) {
    return { status: `ERR ${err.message}`, bytes: 0, ms: Date.now() - t0, acao: null, buf: null };
  }
}

for (const id of ids) {
  console.log(`\n=== ${id}`);
  for (const [name, { ctx, ua, extra, visitor }] of Object.entries(CLIENTS)) {
    try {
      const t0 = Date.now();
      const res = await fetch(PLAYER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": ua,
          ...extra,
          ...(visitor && VISITOR ? { "X-Goog-Visitor-Id": VISITOR } : {}),
        },
        body: JSON.stringify({
          videoId: id,
          contentCheckOk: true,
          racyCheckOk: true,
          context: { client: { ...ctx, hl: "en", gl: "US", ...(visitor && VISITOR ? { visitorData: VISITOR } : {}) } },
        }),
      });
      const json = await res.json();
      const status = json.playabilityStatus?.status;
      const ms = Date.now() - t0;
      if (status !== "OK") {
        console.log(`${name}: ${status ?? res.status} ${json.playabilityStatus?.reason ?? ""} (${ms}ms)`);
        continue;
      }
      const hls = json.streamingData?.hlsManifestUrl;
      const dur = Number(json.videoDetails?.lengthSeconds ?? 0);
      const deep = await deepAdaptive(json, ua);
      if (!hls) {
        console.log(`${name}: OK, no HLS manifest, ${deep} (${ms}ms)`);
        continue;
      }
      const master = await get(hls, AVPLAYER);
      const corsMaster = await get(hls, SAFARI_IPHONE, "capacitor://localhost");
      if (!master.buf) {
        console.log(`${name}: HLS manifest answered ${master.status}`);
        continue;
      }
      const all = variants(master.buf.toString("utf8"), hls);
      const heights = [...new Set(all.map((v) => v.height))].sort((a, b) => a - b).join(",");
      const avc = all
        .filter((v) => /avc1/.test(v.codecs) && v.height <= 1080)
        .sort((a, b) => b.height - a.height || b.bw - a.bw)[0];
      console.log(
        `${name}: HLS ${heights} (${all.length} variants, separate audio: ${all.some((v) => v.audio) ? "yes" : "no"}) ` +
          `${deep}, player ${ms}ms, CORS from capacitor: ${corsMaster.acao ?? "none"}`,
      );
      if (!avc) {
        console.log(`  no H.264 variant ≤1080p; codecs: ${[...new Set(all.map((v) => v.codecs))].join(" | ")}`);
        continue;
      }
      const media = await get(avc.uri, AVPLAYER);
      if (!media.buf) {
        console.log(`  ${avc.height}p media playlist answered ${media.status}`);
        continue;
      }
      const segs = segments(media.buf.toString("utf8"), avc.uri);
      const reads = [];
      const points = [...AT.filter((t) => t < dur), Math.max(0, dur - 15)];
      let cors = null;
      for (const t of points) {
        const seg = [...segs].reverse().find((s) => s.t <= t) ?? segs[0];
        if (!seg) break;
        const r = await get(seg.uri, AVPLAYER);
        reads.push(`${Math.round(t)}s:${r.status}/${(r.bytes / 1e6).toFixed(1)}MB/${r.ms}ms`);
        if (cors === null) cors = (await get(seg.uri, SAFARI_IPHONE, "capacitor://localhost")).acao ?? "none";
      }
      console.log(`  ${avc.height}p ${avc.codecs} ${segs.length} segs — ${reads.join(" ")}; segment CORS: ${cors}`);
    } catch (err) {
      console.log(`${name}: ERR ${err.message}`);
    }
  }
}
