/**
 * Make a folder the offline HD player plays from (GitHub #38). No network.
 *
 *   node scripts/make-offline-hd.mjs <any local video> <output folder>
 *
 * Writes what YouTube would serve for one video, from a file on disk:
 * fragmented MP4s with the `sidx` up front at 1080p, 720p and 480p (H.264,
 * 5-second segments), the sound as an M4A, a 360p single file for the first
 * frame, and `offline.json` describing them. Then, in the vault's
 * `.obsidian/plugins/ytfree/data.json`, set
 *
 *   "devOfflineHd": "<output folder>"
 *
 * and reload the plugin: every video plays from that folder. Remove the key
 * to go back to YouTube. Needs ffmpeg and ffprobe on the PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [input, outArg] = process.argv.slice(2);
if (!input || !outArg) {
  console.log("usage: node scripts/make-offline-hd.mjs <video file> <output folder>");
  process.exit(1);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const ff = (args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", input, ...args], { stdio: "inherit" });
const FRAG = ["-movflags", "frag_keyframe+empty_moov+default_base_moof+global_sidx"];
// A keyframe every 5 s at 30 fps, so every rung has the same segment edges.
const GOP = ["-r", "30", "-g", "150", "-keyint_min", "150", "-sc_threshold", "0"];

const ladder = [
  { height: 1080, kbps: 4500, profile: "high", level: "4.0", codecs: "avc1.640028" },
  { height: 720, kbps: 2500, profile: "main", level: "3.1", codecs: "avc1.4d401f" },
  { height: 480, kbps: 1000, profile: "main", level: "3.0", codecs: "avc1.4d401e" },
];
const videos = [];
for (const r of ladder) {
  const file = `video-${r.height}.mp4`;
  console.log(`encoding ${file}…`);
  ff([
    "-an", "-vf", `scale=-2:${r.height}`, "-c:v", "libx264", "-preset", "veryfast",
    "-profile:v", r.profile, "-level", r.level, "-b:v", `${r.kbps}k`, "-maxrate", `${r.kbps}k`,
    "-bufsize", `${r.kbps * 2}k`, ...GOP, ...FRAG, "-f", "mp4", join(out, file),
  ]);
  const width = Number(
    execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width",
      "-of", "csv=p=0", join(out, file)], { encoding: "utf8" }).trim(),
  );
  videos.push({ file, width, height: r.height, codecs: r.codecs, kbps: r.kbps });
}

console.log("encoding audio.m4a…");
ff(["-vn", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-frag_duration", "5000000", ...FRAG, "-f", "mp4", join(out, "audio.m4a")]);

console.log("encoding 360.mp4…");
ff(["-vf", "scale=-2:360", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "500k", "-c:a", "aac", "-b:a", "96k",
  "-movflags", "+faststart", join(out, "360.mp4")]);

const manifest = { progressive: "360.mp4", videos, audio: { file: "audio.m4a", codecs: "mp4a.40.2", kbps: 128 } };
writeFileSync(join(out, "offline.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nDone. In data.json set: "devOfflineHd": ${JSON.stringify(out)}`);
