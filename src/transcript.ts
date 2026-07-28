/**
 * Transcript parsing and rendering. Platform-neutral on purpose: the one part
 * that needs yt-dlp — fetching the info JSON — lives in
 * `desktop/transcript-fetch.ts`, so this file and its tests stay loadable
 * anywhere.
 */

import { formatTimestamp } from "./format.ts";

/** Headings the fetch owns outright: rewritten wholesale on every run. */
export const TRANSCRIPT_HEADING = "## Transcript";
export const HEATMAP_HEADING = "## Most replayed";

// ------------------------------------------------------------------ shapes

/** One caption line, at the second it starts. */
export interface Cue {
  seconds: number;
  text: string;
}

/** A run of cues rendered under a single seek link. */
export interface Paragraph {
  seconds: number;
  text: string;
}

export interface CaptionTrack {
  url: string;
  /** The yt-dlp language key, e.g. `en` or `en-US-zsweiKMxjbg`. */
  lang: string;
  /** True when this came from YouTube's speech recognition rather than a human. */
  auto: boolean;
}

/** A "most replayed" spike, as YouTube measures it. */
export interface Peak {
  seconds: number;
  /** 0–1, YouTube's own relative replay intensity. */
  value: number;
}

/** The slice of `yt-dlp -J` output we care about. Everything else is ignored. */
export interface VideoInfo {
  subtitles?: Record<string, Array<{ ext?: string; url?: string }>>;
  automatic_captions?: Record<string, Array<{ ext?: string; url?: string }>>;
  heatmap?: Array<{ start_time?: number; end_time?: number; value?: number }>;
  duration?: number;
}

// ----------------------------------------------------------------- selection

/**
 * The best English caption track, human-written for preference.
 *
 * `subtitles` is what the uploader provided and `automatic_captions` is what the
 * speech recogniser guessed, so the former wins when both exist. Language keys
 * are matched by prefix because YouTube's multi-language audio feature produces
 * keys like `en-US-zsweiKMxjbg` alongside plain `en`.
 *
 * json3 only: it carries per-cue start times as numbers, where WebVTT would have
 * to be parsed out of formatted text.
 */
export function pickCaptionTrack(info: VideoInfo, language = "en"): CaptionTrack | null {
  const sources: Array<[Record<string, Array<{ ext?: string; url?: string }>> | undefined, boolean]> =
    [
      [info.subtitles, false],
      [info.automatic_captions, true],
    ];

  for (const [group, auto] of sources) {
    if (!group) continue;
    // Exact match first, so `en` beats `en-US-<id>` when the video has both.
    const keys = Object.keys(group).filter(
      (k) => k === language || k.startsWith(`${language}-`),
    );
    keys.sort((a, b) => (a === language ? -1 : b === language ? 1 : a.localeCompare(b)));

    for (const key of keys) {
      const track = (group[key] || []).find((f) => f.ext === "json3" && f.url);
      if (track?.url) return { url: track.url, lang: key, auto };
    }
  }
  return null;
}

// ------------------------------------------------------------------ parsing

/**
 * json3 splits a caption line into segments, sometimes one per word when the
 * track is auto-generated with word-level timing. Segments are joined back into
 * the line they belong to; only the line's own start time is kept, because
 * per-word links would be unusable.
 */
export function parseJson3(text: string): Cue[] {
  let data: { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }> };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  const cues: Cue[] = [];
  for (const event of data.events || []) {
    if (!event.segs) continue;
    const line = event.segs
      .map((s) => s.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    cues.push({ seconds: Math.floor((event.tStartMs || 0) / 1000), text: line });
  }
  return cues;
}

/**
 * Collect cues into paragraphs of roughly `intervalSeconds` each.
 *
 * The boundary is measured from the paragraph's own start, not from a fixed
 * grid, so a long cue can't push a paragraph to double length. Timestamps stay
 * on real cue starts — a link must land where someone is actually talking, not
 * on a round number in the middle of a sentence.
 */
export function groupCues(cues: Cue[], intervalSeconds: number): Paragraph[] {
  const interval = Math.max(1, Math.floor(intervalSeconds));
  const groups: Array<{ seconds: number; parts: string[] }> = [];

  for (const cue of cues) {
    const current = groups[groups.length - 1];
    if (!current || cue.seconds - current.seconds >= interval) {
      groups.push({ seconds: cue.seconds, parts: [cue.text] });
    } else {
      current.parts.push(cue.text);
    }
  }

  return groups.map((g) => ({
    seconds: g.seconds,
    text: g.parts.join(" ").replace(/\s+/g, " ").trim(),
  }));
}

/**
 * The strongest replay spikes, spread out.
 *
 * Sorting by value alone returns eight buckets of the same moment, because the
 * heatmap is sampled every ~15 seconds and a spike covers several buckets. The
 * greedy minimum-gap pass is what turns "the top eight numbers" into "the top
 * eight moments".
 */
export function topPeaks(
  heatmap: VideoInfo["heatmap"],
  count: number,
  minGapSeconds = 45,
): Peak[] {
  const buckets = (heatmap || [])
    .filter((b) => typeof b.start_time === "number" && typeof b.value === "number")
    .map((b) => ({ seconds: Math.floor(b.start_time as number), value: b.value as number }))
    .sort((a, b) => b.value - a.value || a.seconds - b.seconds);

  const chosen: Peak[] = [];
  for (const bucket of buckets) {
    if (chosen.length >= count) break;
    if (chosen.some((p) => Math.abs(p.seconds - bucket.seconds) < minGapSeconds)) continue;
    chosen.push(bucket);
  }
  // Read down the video, not down the leaderboard: a list you scan while
  // watching wants chronological order.
  return chosen.sort((a, b) => a.seconds - b.seconds);
}

/**
 * What is being said at `seconds`, for labelling a peak.
 *
 * A heatmap spike is a number with no meaning attached, and "3:42" alone tells
 * you nothing about whether it is worth clicking. Returns "" when there is no
 * transcript, in which case the peak is listed bare.
 */
export function cueTextAt(cues: Cue[], seconds: number, maxChars = 100): string {
  if (cues.length === 0) return "";

  let index = 0;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].seconds > seconds) break;
    index = i;
  }

  let text = "";
  for (let i = index; i < cues.length && text.length < maxChars; i++) {
    text = text ? `${text} ${cues[i].text}` : cues[i].text;
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
}

// ----------------------------------------------------------------- markdown

function seekLink(videoId: string, seconds: number): string {
  return `[${formatTimestamp(seconds)}](ytfree:${videoId}:${seconds})`;
}

export function renderTranscript(
  paragraphs: Paragraph[],
  videoId: string,
  track: CaptionTrack | null,
): string {
  const source = track
    ? `_${track.auto ? "Auto-generated" : "Uploaded"} captions (${track.lang}), ${paragraphs.length} sections._`
    : "";
  const body = paragraphs
    .map((p) => `**${seekLink(videoId, p.seconds)}** ${p.text}`)
    .join("\n\n");
  return [source, body].filter(Boolean).join("\n\n");
}

export function renderHeatmap(peaks: Peak[], cues: Cue[], videoId: string): string {
  if (peaks.length === 0) return "";
  return peaks
    .map((peak) => {
      const label = cueTextAt(cues, peak.seconds);
      return `- **${seekLink(videoId, peak.seconds)}**${label ? ` — ${label}` : ""}`;
    })
    .join("\n");
}

/**
 * Replace a top-level section by heading, or append it when absent.
 *
 * The section runs to the next `## ` heading, so a fetch never disturbs the
 * Notes you wrote or the Description above it — and running it twice replaces
 * rather than duplicates. An empty `body` deletes the section, which is how a
 * video with no heatmap avoids leaving an empty heading behind.
 */
export function upsertSection(content: string, heading: string, body: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);

  if (start === -1) {
    if (!body) return content;
    const trimmed = content.replace(/\s+$/, "");
    return `${trimmed}\n\n${heading}\n${body}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const replacement = body ? [heading, body, ""] : [];
  const merged = [...before, ...replacement, ...after].join("\n");
  return merged.replace(/\n{3,}/g, "\n\n");
}
