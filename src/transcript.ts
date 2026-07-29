/**
 * Transcript parsing and rendering. Platform-neutral on purpose: the one part
 * that needs yt-dlp — fetching the info JSON — lives in
 * `desktop/transcript-fetch.ts`, so this file and its tests stay loadable
 * anywhere.
 */

import { formatTimestamp } from "./format.ts";

// Headings the fetch owns outright: rewritten wholesale on every run. They live
// in `sections.ts` with the rest of a note's structure and are re-exported here
// so callers that only care about the transcript keep their one import.
export {
  HEATMAP_ALIASES,
  HEATMAP_HEADING,
  TRANSCRIPT_ALIASES,
  TRANSCRIPT_HEADING,
} from "./sections.ts";

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

/** One entry of `captions.playerCaptionsTracklistRenderer.captionTracks`. */
export interface InnertubeCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  /** `"asr"` for speech recognition; absent for a track a human wrote. */
  kind?: string;
}

export interface CaptionedPlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: InnertubeCaptionTrack[] };
  };
}

/**
 * The same choice, made from an InnerTube player response instead of yt-dlp's
 * info JSON — which is what a phone has, since yt-dlp needs Node.
 *
 * Two differences from `pickCaptionTrack`, both in the data rather than the
 * rule. YouTube states auto-generation as `kind: "asr"` here rather than by
 * which dictionary the track came from, and it hands back a `baseUrl` whose
 * `fmt` is whatever that client defaults to — `srv3` XML on ANDROID. The format
 * is forced to `json3` so the parser downstream is the one file it already was.
 */
export function pickPlayerCaptionTrack(
  response: CaptionedPlayerResponse,
  language = "en",
): CaptionTrack | null {
  const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const usable = tracks.filter(
    (t): t is InnertubeCaptionTrack & { baseUrl: string; languageCode: string } =>
      typeof t.baseUrl === "string" && !!t.baseUrl && typeof t.languageCode === "string",
  );

  // Human-written first, then speech recognition — the same preference the
  // desktop path applies by reading `subtitles` before `automatic_captions`.
  for (const auto of [false, true]) {
    const matching = usable.filter(
      (t) =>
        (t.kind === "asr") === auto &&
        (t.languageCode === language || t.languageCode.startsWith(`${language}-`)),
    );
    // Exact match first, so `en` beats `en-GB` when the video has both.
    matching.sort((a, b) =>
      a.languageCode === language ? -1 : b.languageCode === language ? 1 : a.languageCode.localeCompare(b.languageCode),
    );
    const track = matching[0];
    if (track) return { url: forceJson3(track.baseUrl), lang: track.languageCode, auto };
  }
  return null;
}

/** One `markers` entry of a `MARKER_TYPE_HEATMAP` markers list. */
export interface InnertubeMarker {
  /** Milliseconds, as a string of digits in every response measured. */
  startMillis?: string | number;
  durationMillis?: string | number;
  /** 0–1, and exactly the number yt-dlp calls `value`. */
  intensityScoreNormalized?: number;
}

export interface HeatmapResponse {
  frameworkUpdates?: {
    entityBatchUpdate?: {
      mutations?: Array<{
        payload?: {
          macroMarkersListEntity?: {
            markersList?: { markerType?: string; markers?: InnertubeMarker[] };
          };
        };
      }>;
    };
  };
}

/**
 * The replay heatmap, out of an InnerTube `next` response.
 *
 * The same hundred buckets yt-dlp reports, reached without yt-dlp — which is
 * what puts most-replayed moments on the phone. They are not in the player
 * response at all: they arrive as an *entity mutation* on the watch page's
 * data, alongside whatever else the page was told to update, which is why this
 * has to walk a path rather than read a field.
 *
 * Returned in yt-dlp's own shape (`start_time`/`end_time`/`value`, seconds) so
 * everything downstream — `topPeaks`, `renderHeatmap` — is the one code path it
 * already was. Empty for a video with no heatmap, which is most videos under a
 * few hundred thousand views.
 */
export function parseHeatmapMarkers(response: HeatmapResponse): VideoInfo["heatmap"] {
  const mutations = response.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
  const markers = mutations
    .map((m) => m.payload?.macroMarkersListEntity?.markersList)
    .find((list) => list?.markerType === "MARKER_TYPE_HEATMAP")?.markers;
  if (!markers) return [];

  const buckets: NonNullable<VideoInfo["heatmap"]> = [];
  for (const marker of markers) {
    const start = Number(marker.startMillis);
    const duration = Number(marker.durationMillis);
    const value = marker.intensityScoreNormalized;
    // A bucket with no start or no intensity is not a weaker bucket, it is a
    // shape we do not recognise — dropped rather than guessed at.
    if (!Number.isFinite(start) || typeof value !== "number" || !Number.isFinite(value)) continue;
    buckets.push({
      start_time: start / 1000,
      end_time: (start + (Number.isFinite(duration) ? duration : 0)) / 1000,
      value,
    });
  }
  return buckets;
}

/**
 * Ask a timedtext URL for json3.
 *
 * The signature covers `sparams`, and `fmt` is not in it — measured against
 * both the ANDROID and IOS clients — so overwriting it keeps the URL valid.
 */
function forceJson3(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    return url.toString();
  } catch {
    // Not parseable as a URL: append rather than lose the track entirely.
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
  }
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

/** `**[12:34](ytfree:ID:754)** the words` — one line of a rendered transcript. */
const RENDERED_CUE_RE = /^\*\*\[[^\]]*\]\(ytfree:[^:)]+:(\d+)\)\*\*\s*(.*)$/;

/**
 * Read a rendered transcript back out of a note, as cues.
 *
 * For the backfill case: a note written before the heatmap worked on that
 * platform already has the transcript, and re-downloading a caption file to
 * label eight peaks would be paying twice for words that are sitting in the
 * file. Granularity is the paragraph interval rather than the caption line,
 * which is a label of a few seconds' slack — invisible next to a peak bucket
 * that is ten seconds wide anyway.
 *
 * Anything that is not a transcript line is skipped, so the source italic, the
 * headings and any prose a person added in the section are all ignored.
 */
export function parseTranscriptCues(content: string): Cue[] {
  const cues: Cue[] = [];
  for (const line of content.split("\n")) {
    const match = RENDERED_CUE_RE.exec(line.trim());
    if (!match) continue;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds)) continue;
    const text = match[2].trim();
    if (text) cues.push({ seconds, text });
  }
  return cues;
}

/**
 * Close a note off: a rule under the last section, then two blank lines.
 *
 * The transcript is the last thing in the file and it ends mid-sentence, so
 * there is nothing telling the eye the note is over — and nowhere to type when
 * you come back to it. The rule says "end", the blank lines are the landing
 * space.
 *
 * Idempotent: an existing footer is stripped before the new one goes on, so a
 * re-fetch never stacks a second rule under the first.
 */
export function ensureFooter(content: string): string {
  const body = content.replace(/(?:\s*\n\s*(?:---|\*\*\*|___)\s*)*\s*$/, "");
  return `${body}\n\n---\n\n\n`;
}

/**
 * Replace a top-level section by heading, or append it when absent.
 *
 * The section runs to the next heading, so a fetch never disturbs the Notes you
 * wrote or the description above it — and running it twice replaces rather than
 * duplicates. An empty `body` deletes the section, which is how a video with no
 * heatmap avoids leaving an empty heading behind.
 *
 * `aliases` is what stops the rename from level two to level one turning every
 * re-fetch into a duplicate section: a note still carrying `## Transcript` is
 * found by its old name and comes back with the new one. It defaults to the
 * heading itself, so a caller with nothing to migrate passes nothing.
 */
export function upsertSection(
  content: string,
  heading: string,
  body: string,
  aliases: string[] = [heading],
  anchor: string[] = [],
): string {
  const lines = content.split("\n");
  const wanted = new Set([heading, ...aliases]);
  const start = lines.findIndex((line) => wanted.has(line.trim()));

  if (start === -1) {
    if (!body) return content;
    // `anchor` is for the section that has to land *above* something rather
    // than at the end: a heatmap backfilled into a note that already has a
    // transcript belongs before it, not five thousand words below it.
    const anchored = anchor.length
      ? lines.findIndex((line) => anchor.includes(line.trim()))
      : -1;
    if (anchored !== -1) {
      const merged = [
        ...lines.slice(0, anchored),
        heading,
        body,
        "",
        ...lines.slice(anchored),
      ].join("\n");
      return merged.replace(/\n{3,}/g, "\n\n");
    }
    const trimmed = content.replace(/\s+$/, "");
    return `${trimmed}\n\n${heading}\n${body}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // Level one or two: the sections are level one now and were level two
    // before, and a note in either state has to stop at the right place.
    if (/^#{1,2}\s/.test(lines[i])) {
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
