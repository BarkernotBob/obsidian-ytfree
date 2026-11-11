/**
 * The shape of a replay fixture (GitHub #38), shared by the recorder and the
 * replay tests so they cannot drift.
 *
 *   tests/fixtures/replay/<name>/
 *     ytdlp.json            `yt-dlp -J`, trimmed (src/answer-trim.ts), URLs rewritten
 *     player-android.json   the ANDROID player answer, trimmed, URLs rewritten (optional)
 *     bytes/<itag>.bin      each HD file's opening, through the end of its `sidx`
 *     captions/<lang>.json3 the caption file the transcript would read (optional)
 *     about.json            where it came from, when, and what it cost
 *
 * Every googlevideo URL becomes `https://fixture.invalid/v/<itag>` with an
 * expiry in 2100, so a fixture names no real server, ages never, and replays
 * the same on any machine.
 */
import type { FetchRange } from "../src/adaptive.ts";

export const FIXTURE_HOST = "https://fixture.invalid/";
/** 2100-01-01: far enough that a fixture never reads as expired. */
export const FIXTURE_EXPIRE = 4102444800;

/** A real media or caption URL as the fixture's stand-in; anything else unchanged. */
export function rewriteUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname;
  if (host.endsWith("googlevideo.com")) {
    if (host.startsWith("manifest.")) return `${FIXTURE_HOST}hls?expire=${FIXTURE_EXPIRE}`;
    const itag = parsed.searchParams.get("itag") ?? parsed.pathname.match(/\/itag\/(\d+)/)?.[1] ?? "0";
    return `${FIXTURE_HOST}v/${itag}?expire=${FIXTURE_EXPIRE}`;
  }
  if (parsed.pathname.endsWith("/api/timedtext")) {
    const lang = parsed.searchParams.get("lang") ?? "und";
    const fmt = parsed.searchParams.get("fmt") ?? "srv3";
    return `${FIXTURE_HOST}timedtext/${lang}.${fmt}`;
  }
  return url;
}

/** Every URL string anywhere in `value`, rewritten. */
export function rewriteUrls<T>(value: T): T {
  if (typeof value === "string") return (/^https?:\/\//.test(value) ? rewriteUrl(value) : value) as T;
  if (Array.isArray(value)) return value.map(rewriteUrls) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteUrls(v);
    return out as T;
  }
  return value;
}

/** The itag a fixture URL names, or null. */
export function fixtureItag(url: string): string | null {
  return url.startsWith(`${FIXTURE_HOST}v/`) ? url.slice(FIXTURE_HOST.length + 2).split(/[?&]/)[0] : null;
}

/**
 * Byte ranges answered from a fixture's recorded openings. A range inside the
 * recording is the recorded bytes; one past it (a media segment, the 90 s
 * check) is zeros of the asked length, since segments are not recorded.
 * Counts every read, so a test can hold the resolve to its budget.
 */
export function replayFetch(bytes: Record<string, Uint8Array>): FetchRange & { reads: Array<[string, number, number]> } {
  const reads: Array<[string, number, number]> = [];
  const fetch = (async (url: string, start: number, end: number) => {
    reads.push([url, start, end]);
    const itag = fixtureItag(url);
    const file = itag === null ? undefined : bytes[itag];
    if (!file) throw Object.assign(new Error("HTTP 404"), { status: 404 });
    if (start < file.length) return file.slice(start, Math.min(end + 1, file.length)).buffer;
    return new ArrayBuffer(Math.min(end - start + 1, 1 << 20));
  }) as FetchRange & { reads: Array<[string, number, number]> };
  fetch.reads = reads;
  return fetch;
}
