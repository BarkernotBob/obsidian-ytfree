/**
 * Smart Speed's brain: silence maps, and every decision made from one.
 *
 * Deliberately pure and platform-neutral — no Obsidian, no Node, no DOM. The
 * three things that *do* touch a platform live elsewhere: `silence-store.ts`
 * writes the file, `desktop/silencedetect.ts` runs ffmpeg, and `player.ts`
 * moves `playbackRate`. Everything they decide is decided here, where it can be
 * unit-tested without a video element or a phone.
 *
 * The shape is one apply layer fed by interchangeable producers. A producer
 * emits **raw** silence intervals — the actual quiet stretches, untrimmed and
 * unfiltered. The apply layer is what turns those into the windows playback
 * actually compresses, which is why the user's "how long is a skippable pause"
 * setting can change with no refetch and no recompute: it is a filter applied
 * at the last moment, not a number baked into the stored map.
 */

/** A stretch of the video where nothing worth hearing happens, in seconds. */
export interface SilenceWindow {
  start: number;
  end: number;
}

/**
 * Which producer made a map. Ranked: an ffmpeg map is measured from the audio
 * itself and beats a map inferred from caption timing, always.
 */
export type SilenceSource = "transcript" | "ffmpeg";

const SOURCE_RANK: Record<SilenceSource, number> = { transcript: 0, ffmpeg: 1 };

export interface SilenceMap {
  videoId: string;
  source: SilenceSource;
  /** ISO timestamp, so a newer map of the same source wins on a re-merge. */
  computedAt: string;
  /**
   * The minimum silence length the producer ran with, in seconds.
   *
   * Stored because it is a floor, not a preference: a map built at 0.5 s simply
   * does not contain the 0.3 s pauses, so it cannot answer a later question
   * asked at 0.3 s. Raising the setting re-filters an existing map for free;
   * lowering it past this number makes the map stale — see `isStale`.
   */
  minGap: number;
  windows: SilenceWindow[];
}

export interface SilenceState {
  version: 1;
  maps: Record<string, SilenceMap>;
}

/**
 * How much of a pause plays at speech rate before the compression kicks in, and
 * how early it lets go.
 *
 * Overcast's trick, and the reason it sounds like editing rather than like a
 * broken player: a pause that is compressed from its very first millisecond
 * clips the tail of the word before it, and one that runs at 3× right up to the
 * next syllable swallows a soft onset. The two numbers are asymmetric because
 * the ear is — a late release is much more audible than a late start.
 */
export const LEAD_IN_SECONDS = 0.15;
export const LEAD_OUT_SECONDS = 0.1;

/** Past this many videos, the least recently computed maps are dropped. */
export const MAX_SILENCE_MAPS = 200;

/**
 * Float slack for comparing two settings values.
 *
 * A slider hands back 0.5 and a stored map says 0.5000000000000001; without
 * this every map computed before the last restart would look stale and every
 * video would be re-analysed on open.
 */
const EPSILON = 1e-6;

export function emptySilenceState(): SilenceState {
  return { version: 1, maps: {} };
}

/**
 * Read a state file back, keeping only what is actually usable.
 *
 * The file is written by two devices through iCloud, so "malformed" here does
 * not mean "someone edited it by hand" — it means a half-synced write, or a
 * version of the plugin that stored a field this one does not know. Anything
 * that does not parse into a complete map is dropped rather than guessed at:
 * the cost is one recompute, and a recompute is cheap.
 */
export function normalizeSilenceState(raw: unknown): SilenceState {
  const state = emptySilenceState();
  const maps = (raw as { maps?: unknown } | null)?.maps;
  if (!maps || typeof maps !== "object") return state;

  for (const [videoId, value] of Object.entries(maps as Record<string, unknown>)) {
    const map = normalizeMap(videoId, value);
    if (map) state.maps[videoId] = map;
  }
  return state;
}

function normalizeMap(videoId: string, value: unknown): SilenceMap | null {
  const raw = value as Partial<SilenceMap> | null;
  if (!raw || typeof raw !== "object") return null;
  if (raw.source !== "transcript" && raw.source !== "ffmpeg") return null;
  if (typeof raw.computedAt !== "string") return null;
  if (typeof raw.minGap !== "number" || !Number.isFinite(raw.minGap)) return null;
  if (!Array.isArray(raw.windows)) return null;

  return {
    videoId,
    source: raw.source,
    computedAt: raw.computedAt,
    minGap: raw.minGap,
    windows: sortWindows(raw.windows.filter(isWindow)),
  };
}

function isWindow(value: unknown): value is SilenceWindow {
  const w = value as Partial<SilenceWindow> | null;
  return (
    !!w &&
    typeof w.start === "number" &&
    typeof w.end === "number" &&
    Number.isFinite(w.start) &&
    Number.isFinite(w.end) &&
    w.end > w.start
  );
}

function sortWindows(windows: SilenceWindow[]): SilenceWindow[] {
  return [...windows].sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ producer

/** A caption line with both ends of its timing, in seconds. */
export interface TimedCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Caption gaps → silence windows. The zero-dependency producer: this is what a
 * stranger with no ffmpeg and no yt-dlp gets, on a phone as much as a laptop.
 *
 * Two details do the real work. Cues are walked against a **running maximum**
 * end rather than against the previous cue's end, because auto-generated
 * captions overlap constantly — the rolling two-line style emits an event that
 * starts before the one before it has finished, and comparing neighbours pairwise
 * would report a negative gap and then miss the real pause after it. And a cue
 * with no stated duration does not become a zero-length cue, which would invent
 * a silence covering the whole line; it borrows the next cue's start, which is
 * the conservative reading — no gap rather than a false one.
 *
 * The gap before the very first word is included. It is usually a title card or
 * an intro sting, and compressing it is exactly the known limitation the
 * transcript producer carries: caption timing cannot tell silence from music.
 * ffmpeg can, and replaces this map when it is there.
 */
export function windowsFromCues(cues: TimedCue[], minGap: number): SilenceWindow[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const floor = Math.max(0, minGap);
  const windows: SilenceWindow[] = [];
  let covered = 0;

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i];
    if (!Number.isFinite(cue.start) || cue.start < 0) continue;

    if (cue.start - covered >= floor) {
      windows.push({ start: covered, end: cue.start });
    }

    const stated = Number.isFinite(cue.end) && cue.end > cue.start ? cue.end : null;
    const borrowed = sorted[i + 1]?.start ?? cue.start;
    covered = Math.max(covered, stated ?? Math.max(cue.start, borrowed));
  }

  return windows;
}

// -------------------------------------------------------------- apply layer

/**
 * The windows playback should actually compress, at the setting in force right
 * now.
 *
 * Filtering and trimming happen here rather than in the producer so that
 * "minimum silence length" is a live control: drag the slider and the next
 * frame obeys it, with no refetch, no ffmpeg re-run and no rewritten file. The
 * order matters — filter on the *raw* length, then trim, because a 0.5 s pause
 * trimmed to 0.25 s is still a 0.5 s pause the user asked to skip.
 */
export function compressibleWindows(
  windows: SilenceWindow[],
  minGap: number,
): SilenceWindow[] {
  const floor = Math.max(0, minGap);
  const out: SilenceWindow[] = [];
  for (const window of windows) {
    if (window.end - window.start < floor - EPSILON) continue;
    const start = window.start + LEAD_IN_SECONDS;
    const end = window.end - LEAD_OUT_SECONDS;
    // A window whose margins meet is a pause too short to be worth entering:
    // the player would change rate twice for a few hundred milliseconds and the
    // only audible result would be the wobble.
    if (end - start <= 0) continue;
    out.push({ start, end });
  }
  return sortWindows(out);
}

/**
 * Is `seconds` inside one of these windows? Binary search, because this is
 * called once per animation frame against a map that can hold a few thousand
 * windows for a long video.
 */
export function windowAt(windows: SilenceWindow[], seconds: number): SilenceWindow | null {
  let low = 0;
  let high = windows.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const window = windows[mid];
    if (seconds < window.start) high = mid - 1;
    else if (seconds >= window.end) low = mid + 1;
    else return window;
  }
  return null;
}

/**
 * The rate the video should be playing at, this instant.
 *
 * `max` and not the silence rate outright: someone listening at 2× has already
 * said they want to go faster than 1.5×, and a pause is never the moment to
 * slow down. The pure function the whole feature turns on, so it is the one
 * that gets tested hardest.
 */
export function rateFor(
  seconds: number,
  windows: SilenceWindow[],
  baseRate: number,
  silenceRate: number,
): number {
  if (windows.length === 0) return baseRate;
  return windowAt(windows, seconds) ? Math.max(baseRate, silenceRate) : baseRate;
}

/**
 * Listening time saved by playing `wallSeconds` at `rate` instead of `baseRate`.
 *
 * Content covered is `wallSeconds × rate`; at the user's chosen speed that same
 * content would have taken `wallSeconds × rate / baseRate`. The difference is
 * what the readout counts — a 3 s pause played at 3× instead of 1× reports 2 s
 * saved, which is the number a listener would agree with.
 */
export function secondsSaved(wallSeconds: number, baseRate: number, rate: number): number {
  if (baseRate <= 0 || rate <= baseRate) return 0;
  return wallSeconds * (rate / baseRate - 1);
}

// ---------------------------------------------------------------- the store

/**
 * Does this map still answer the question being asked?
 *
 * Only downwards. A map built with a 0.5 s floor contains every pause of 0.5 s
 * and longer, so it answers 0.8 s perfectly well by filtering; it cannot answer
 * 0.3 s, because the 0.3 s pauses were never in it.
 */
export function isStale(map: SilenceMap, minGap: number): boolean {
  return map.minGap > minGap + EPSILON;
}

/**
 * Should `incoming` replace `existing`?
 *
 * ffmpeg beats transcript regardless of age — it is measured rather than
 * inferred, and a stale measurement is still a measurement. Within one source,
 * a finer floor beats a coarser one (it strictly contains it), and only then
 * does recency decide.
 */
export function isBetterMap(incoming: SilenceMap, existing: SilenceMap | undefined): boolean {
  if (!existing) return true;
  if (SOURCE_RANK[incoming.source] !== SOURCE_RANK[existing.source]) {
    return SOURCE_RANK[incoming.source] > SOURCE_RANK[existing.source];
  }
  if (Math.abs(incoming.minGap - existing.minGap) > EPSILON) {
    return incoming.minGap < existing.minGap;
  }
  return incoming.computedAt > existing.computedAt;
}

/**
 * Fold new maps into the state, in place. Returns whether anything changed.
 *
 * This is a merge and not an assignment for the reason issue 014 cost a day of
 * hidden videos coming back: the file is written by a Mac and an iPhone against
 * the same iCloud folder, so the last writer holding a whole-file snapshot
 * silently deletes whatever the other one added. Re-read, union by video ID,
 * let `isBetterMap` arbitrate — then write.
 */
export function mergeSilenceMaps(state: SilenceState, incoming: SilenceMap[]): boolean {
  let changed = false;
  for (const map of incoming) {
    if (!isBetterMap(map, state.maps[map.videoId])) continue;
    state.maps[map.videoId] = map;
    changed = true;
  }
  return changed;
}

/**
 * Keep the file small. Maps are a few hundred bytes each, so the cap is about
 * not letting a sync file grow without bound rather than about disk.
 */
export function pruneSilenceMaps(state: SilenceState, max = MAX_SILENCE_MAPS): boolean {
  const ids = Object.keys(state.maps);
  if (ids.length <= max) return false;
  const doomed = ids
    .sort((a, b) => state.maps[a].computedAt.localeCompare(state.maps[b].computedAt))
    .slice(0, ids.length - max);
  for (const id of doomed) delete state.maps[id];
  return true;
}

// ------------------------------------------------------------ ffmpeg parsing

/**
 * `silencedetect`'s report, out of ffmpeg's stderr.
 *
 * The filter prints one line when a quiet stretch begins and another when it
 * ends, interleaved with everything else ffmpeg has to say:
 *
 * ```
 * [silencedetect @ 0x14f605c30] silence_start: 12.3457
 * [silencedetect @ 0x14f605c30] silence_end: 13.4561 | silence_duration: 1.1104
 * ```
 *
 * A pure function on text, because ffmpeg's output is the one part of this
 * feature that cannot be reproduced in a test without ffmpeg. A `silence_start`
 * with no matching `silence_end` — which is what a still-running analysis, or
 * one killed when the note closed, always ends with — yields nothing rather
 * than a window running to infinity.
 */
export function parseSilencedetect(text: string): SilenceWindow[] {
  const stream = createSilencedetectStream();
  return [...stream.push(text), ...stream.flush()];
}

/**
 * The same parser, fed a chunk at a time.
 *
 * silencedetect reports as the analysis runs — far faster than realtime on an
 * audio-only stream — and the point of that is to hand windows to a *playing*
 * video rather than to a finished file. So chunks arrive mid-line, and both the
 * partial line and a `silence_start` still waiting for its end have to survive
 * to the next one.
 */
export function createSilencedetectStream(): {
  push: (chunk: string) => SilenceWindow[];
  flush: () => SilenceWindow[];
} {
  let pending = "";
  let start: number | null = null;

  const consume = (text: string): SilenceWindow[] => {
    const windows: SilenceWindow[] = [];
    for (const line of text.split(/\r?\n/)) {
      const startMatch = /silence_start:\s*(-?[\d.]+)/.exec(line);
      if (startMatch) {
        const value = Number(startMatch[1]);
        if (Number.isFinite(value)) start = Math.max(0, value);
        continue;
      }
      const endMatch = /silence_end:\s*(-?[\d.]+)/.exec(line);
      if (endMatch && start !== null) {
        const end = Number(endMatch[1]);
        if (Number.isFinite(end) && end > start) windows.push({ start, end });
        start = null;
      }
    }
    return windows;
  };

  return {
    push(chunk: string): SilenceWindow[] {
      pending += chunk;
      const cut = pending.lastIndexOf("\n");
      if (cut === -1) return [];
      const complete = pending.slice(0, cut);
      pending = pending.slice(cut + 1);
      return consume(complete);
    },
    flush(): SilenceWindow[] {
      const rest = pending;
      pending = "";
      return rest ? consume(rest) : [];
    },
  };
}
