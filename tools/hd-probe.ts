/**
 * What the stitched HD stream does over a whole video, measured outside the app.
 *
 *   node tools/hd-probe.ts [videoId ...]
 *
 * For each video: how long the HD resolve takes, then one video and one audio
 * segment fetched at several points through the file (with the time each took
 * and its status), and the same for the 360p single file. A refusal partway
 * through, or a slow segment, shows up here without opening Obsidian.
 * Uses plain `fetch`, which is what the smoke test uses too.
 */
import { resolveHd, withRange } from "../src/adaptive.ts";
import { CLIENTS, PLAYER_URL, playerBody } from "../src/innertube-context.ts";

const ids = process.argv.slice(2);
if (!ids.length) ids.push("dQw4w9WgXcQ", "jNQXAC9IVRw", "aqz-KE-bpKQ");

async function player(videoId: string, client: "android" | "ios") {
  const { ctx, ua } = CLIENTS[client];
  const res = await fetch(PLAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({ ...playerBody(videoId), context: { client: { ...ctx, hl: "en", gl: "US" } } }),
  });
  return { json: await res.json(), ua };
}

async function range(url: string, start: number, end: number, ua?: string) {
  const t = performance.now();
  const res = await fetch(withRange(url, start, end), { headers: ua ? { "User-Agent": ua } : {} });
  const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
  return { status: res.status, bytes, ms: Math.round(performance.now() - t) };
}

const AT = [0, 30, 45, 50, 55, 60, 65, 90, 180];

for (const id of ids) {
  console.log(`\n=== ${id}`);
  const t0 = performance.now();
  const ask = async (client: string) => {
    const { json, ua } = await player(id, client as "android" | "ios");
    if (json.playabilityStatus?.status !== "OK") return null;
    return { adaptiveFormats: json.streamingData?.adaptiveFormats ?? [], hlsManifestUrl: json.streamingData?.hlsManifestUrl ?? null, ua };
  };
  let stream;
  try {
    stream = await resolveHd(id, ["android", "ios"], ask, async (u, s, e, ua) => {
      const res = await fetch(withRange(u, s, e), { headers: ua ? { "User-Agent": ua } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    });
  } catch (err) {
    console.log(`HD resolve failed after ${Math.round(performance.now() - t0)} ms: ${(err as Error).message}`);
    continue;
  }
  console.log(`HD resolve: ${Math.round(performance.now() - t0)} ms, ${stream.height}p, virtual=${!!stream.virtual}`);
  if (!stream.virtual) continue;
  const ua = (await ask("android"))?.ua;

  for (const [name, text] of Object.entries(stream.virtual.files)) {
    if (name.endsWith("master.m3u8")) continue;
    const segs = [...text.matchAll(/#EXTINF:([\d.]+),\n#EXT-X-BYTERANGE:(\d+)@(\d+)\n(\S+)/g)].map((m) => ({
      dur: Number(m[1]), len: Number(m[2]), at: Number(m[3]), url: m[4],
    }));
    const durs = segs.map((s) => s.dur);
    console.log(`${name.split("/").pop()}: ${segs.length} segments, ${Math.min(...durs).toFixed(2)}–${Math.max(...durs).toFixed(2)} s each`);
    if (name.includes("audio") || name.includes(`video-${stream.height}.`) || name.includes("video-240.")) {
      let clock = 0;
      const starts = segs.map((s) => { const c = clock; clock += s.dur; return c; });
      for (const t of AT) {
        const i = starts.findLastIndex((c) => c <= t);
        if (i < 0 || t > clock) continue;
        const s = segs[i];
        const r = await range(s.url, s.at, s.at + s.len - 1, ua);
        const kbps = r.ms ? Math.round((r.bytes * 8) / r.ms) : 0;
        console.log(`  t=${t}s seg ${i} (${starts[i].toFixed(1)}s, ${s.len} B): HTTP ${r.status} in ${r.ms} ms (${kbps} kbit/s)`);
      }
    }
  }

  // The 360p single file, read at the same points by byte share of the file.
  const { json: a, ua: aua } = await player(id, "android");
  const f18 = a.streamingData?.formats?.find((f: { itag: number }) => f.itag === 18);
  const total = Number(f18?.contentLength ?? 0);
  const dur = Number(f18?.approxDurationMs ?? 0) / 1000;
  if (f18?.url && total && dur) {
    for (const t of AT.filter((x) => x < dur)) {
      const at = Math.floor((t / dur) * total);
      const r = await range(f18.url, at, Math.min(total - 1, at + 512 * 1024 - 1), aua);
      console.log(`  360p t≈${t}s 512 KiB: HTTP ${r.status} in ${r.ms} ms`);
    }
  }
}
