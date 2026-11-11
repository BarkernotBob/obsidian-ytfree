/**
 * The desktop HD path from yt-dlp's files, end to end outside the app.
 *
 *   node scripts/ytdlp-hd-probe.ts [videoId ...]
 *
 * Runs `yt-dlp -J`, builds the stitched stream exactly as the plugin does
 * (`resolveHdFromYtDlp`, including the check past the first minute), then
 * reads one top-rung segment at several points through the video.
 */
import { liveGuard } from "./live-budget.mjs";
import { execFileSync } from "node:child_process";
import { resolveHdFromYtDlp, withRange } from "../src/adaptive.ts";
import type { YtDlpFormat } from "../src/adaptive.ts";

// Once a day per machine, counted (GitHub #39). `--force` overrides.
const budget = liveGuard("ytdlp-hd-probe");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!ids.length) ids.push("aqz-KE-bpKQ");
const bin = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"].find((p) => {
  try { execFileSync(p, ["--version"]); return true; } catch { return false; }
}) ?? "yt-dlp";

const fetchRange = async (url: string, start: number, end: number): Promise<ArrayBuffer> => {
  const res = await fetch(withRange(url, start, end));
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.arrayBuffer();
};

for (const id of ids) {
  console.log(`\n=== ${id}`);
  const t0 = performance.now();
  budget.ytDlp();
  const info = JSON.parse(
    execFileSync(bin, ["--no-warnings", "--no-playlist", "-J", `https://www.youtube.com/watch?v=${id}`], { encoding: "utf8", maxBuffer: 64 << 20 }),
  ) as { formats: YtDlpFormat[] };
  const t1 = performance.now();
  try {
    const stream = await resolveHdFromYtDlp(id, info.formats, fetchRange);
    console.log(`yt-dlp -J ${Math.round(t1 - t0)} ms, stitch + checks ${Math.round(performance.now() - t1)} ms, ${stream.height}p`);
    const files = stream.virtual!.files;
    const top = Object.entries(files).find(([k]) => k.endsWith(`video-${stream.height}.m3u8`))![1].split("\n");
    let clock = 0;
    const want = [0, 60, 90, 180, 600];
    for (let i = 0; i < top.length; i++) {
      if (!top[i].startsWith("#EXTINF:")) continue;
      const dur = Number(top[i].slice(8, -1));
      const [len, off] = top[i + 1].split(":")[1].split("@").map(Number);
      if (want.length && clock >= want[0]) {
        want.shift();
        const t = performance.now();
        try {
          await stream.virtual!.fetchRange(top[i + 2], off, off + len - 1);
          console.log(`  ${Math.round(clock)}s: ok, ${len} bytes in ${Math.round(performance.now() - t)} ms`);
        } catch (err) {
          console.log(`  ${Math.round(clock)}s: ${(err as Error).message}`);
        }
      }
      clock += dur;
    }
  } catch (err) {
    console.log(`failed: ${(err as Error).message}`);
  }
}
