import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import { readdir, statfs, unlink } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

const pExecFile = promisify(execFile);

/** Same PATH problem as yt-dlp: Electron does not inherit a login shell's PATH. */
const FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
  "/opt/local/bin/ffmpeg",
];

/** Refuse to start a download with less than this much room left. */
export const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

/** Warn (but proceed) above this download size. */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export async function findFfmpeg(configured: string): Promise<string | null> {
  const candidates = configured ? [configured, ...FFMPEG_CANDIDATES] : FFMPEG_CANDIDATES;
  for (const path of candidates) {
    try {
      await pExecFile(path, ["-version"], { timeout: 10_000 });
      return path;
    } catch {
      // next
    }
  }
  return null;
}

/**
 * Strip what macOS and Obsidian both dislike in a filename, and cap the length
 * so the `[videoId]` suffix — the part the plugin actually matches on — is never
 * the thing that gets truncated away.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
}

/**
 * `Some Title [abc123XYZ_]`.
 *
 * The title is for a human browsing Finder; the bracketed ID is the identity.
 * Renaming either the note or the file is therefore harmless, as long as the
 * bracket survives — which `findByVideoId` relies on.
 */
export function downloadBaseName(title: string, videoId: string): string {
  const clean = sanitizeFilename(title);
  return clean ? `${clean} [${videoId}]` : videoId;
}

/** The first filename carrying this video's ID in brackets, or null. */
export function findByVideoId(files: string[], videoId: string): string | null {
  const needle = `[${videoId}]`;
  return files.find((f) => f.includes(needle) && !f.endsWith(".part")) ?? null;
}

const UNITS: Record<string, number> = {
  B: 1,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

/**
 * A yt-dlp progress line, e.g.
 * `[download]   1.2% of  723.45MiB at  5.00MiB/s ETA 02:24`.
 *
 * Returns null for every other line, of which there are many — this runs on all
 * of yt-dlp's stdout, so anything unrecognised must simply be ignored.
 */
export function parseProgress(line: string): { percent: number; totalBytes: number | null } | null {
  const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(B|KiB|MiB|GiB|TiB)/i);
  if (!m) return null;
  const unit = UNITS[m[3].toUpperCase()] ?? 1;
  return { percent: Number(m[1]), totalBytes: Math.round(Number(m[2]) * unit) };
}

export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null; // statfs is not worth failing a download over
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Format selector.
 *
 * Anything above ~720p arrives as separate video and audio streams that need
 * ffmpeg to merge. Without ffmpeg we ask for a pre-muxed format instead: a
 * worse download beats a failed one.
 */
export function formatSelector(hasFfmpeg: boolean): string {
  return hasFfmpeg ? "bv*+ba/b" : "b[ext=mp4]/b";
}

export interface DownloadOptions {
  videoId: string;
  ytDlpPath: string;
  ffmpegPath: string | null;
  destDir: string;
  baseName: string;
  onProgress: (percent: number, totalBytes: number | null) => void;
}

export interface DownloadHandle {
  /** Resolves with the absolute path of the finished file. */
  done: Promise<string>;
  cancel: () => void;
}

export function buildArgs(opts: DownloadOptions): string[] {
  const args = [
    "--no-warnings",
    "--no-playlist",
    "--newline",
    "--no-simulate",
    // Prints the path *after* any merge and rename, so we learn the real
    // extension instead of guessing it.
    "--print",
    "after_move:filepath",
    "-f",
    formatSelector(Boolean(opts.ffmpegPath)),
    "-o",
    join(opts.destDir, `${opts.baseName}.%(ext)s`),
  ];
  if (opts.ffmpegPath) args.push("--ffmpeg-location", opts.ffmpegPath);
  args.push(`https://www.youtube.com/watch?v=${opts.videoId}`);
  return args;
}

/**
 * Download, reporting progress as it goes.
 *
 * yt-dlp stages into its own `.part` file and renames on success, so an
 * interrupted download can never be mistaken for a complete one. Cancelling
 * kills the process and sweeps the partials, because a stale `.part` would
 * otherwise be silently resumed into much later.
 */
export function downloadVideo(opts: DownloadOptions): DownloadHandle {
  const child = spawn(opts.ytDlpPath, buildArgs(opts));
  let cancelled = false;
  let finalPath = "";
  let stderr = "";

  const done = new Promise<string>((resolve, reject) => {
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const progress = parseProgress(line);
        if (progress) {
          opts.onProgress(progress.percent, progress.totalBytes);
        } else if (line.trim().startsWith("/")) {
          finalPath = line.trim(); // the after_move:filepath print
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (cancelled) {
        void sweepPartials(opts.destDir, opts.baseName);
        reject(new Error("cancelled"));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      if (finalPath && existsSync(finalPath)) {
        resolve(finalPath);
        return;
      }
      // yt-dlp said it succeeded but printed nothing usable; fall back to the
      // filename convention, which is enough because the ID is in the name.
      void findExisting(opts.destDir, opts.baseName).then((found) =>
        found ? resolve(found) : reject(new Error("download finished but the file was not found")),
      );
    });
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      child.kill();
    },
  };
}

async function findExisting(dir: string, baseName: string): Promise<string | null> {
  try {
    const files = await readdir(dir);
    const hit = files.find((f) => f.startsWith(baseName + ".") && !f.endsWith(".part"));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

/** Remove `.part` / `.ytdl` leftovers from a cancelled or crashed download. */
export async function sweepPartials(dir: string, baseName: string): Promise<void> {
  try {
    const files = await readdir(dir);
    await Promise.all(
      files
        .filter((f) => f.startsWith(baseName) && (f.endsWith(".part") || f.endsWith(".ytdl")))
        .map((f) => unlink(join(dir, f)).catch(() => undefined)),
    );
  } catch {
    // nothing to sweep
  }
}

/**
 * Where the note's local copy actually is right now.
 *
 * The recorded path is checked first; if it has moved, the folder is searched
 * for the `[videoId]` marker, so renaming the file in Finder does not break the
 * note. Returns null when there is no local copy on this machine — which is the
 * normal case on a second Mac, and must stay silent rather than erroring.
 */
export async function resolveLocalFile(
  recordedPath: string,
  destDir: string,
  videoId: string,
): Promise<string | null> {
  if (recordedPath && existsSync(recordedPath)) return recordedPath;
  try {
    const found = findByVideoId(await readdir(destDir), videoId);
    return found ? join(destDir, found) : null;
  } catch {
    return null;
  }
}

/**
 * Obsidian serves arbitrary local files through its own `app://local/` handler;
 * a bare `file://` URL is blocked by the renderer's security policy.
 */
export function localFileUrl(absolutePath: string): string {
  return "app://local" + encodeURI(absolutePath).replace(/[?#]/g, (c) => encodeURIComponent(c));
}
