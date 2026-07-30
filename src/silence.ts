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
 * Which producer made a map.
 *
 * **Not ranked any more, and that is issue 016's central change.** 015 held that
 * ffmpeg strictly beat caption timing, because measured audio can tell a musical
 * interlude from a pause. BarkernotBob's answer was that an interlude is fluff and
 * fluff is what Smart Speed is for, so the two producers now answer *different*
 * questions — "nobody is speaking" and "nothing is audible" — and playback
 * compresses the union of them. Neither replaces the other, so both are stored.
 */
export type SilenceSource = "transcript" | "ffmpeg";

export const SILENCE_SOURCES: SilenceSource[] = ["transcript", "ffmpeg"];

/** One producer's answer for one video. */
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
  /**
   * How far into the video this producer actually got, in seconds. `undefined`
   * means "all of it".
   *
   * Only ffmpeg sets it, and it exists because 015 recorded a killed analysis as
   * if it had finished: closing the note after twenty seconds stored a
   * twenty-second map that then outranked everything for good. A partial map is
   * a useful thing to keep — it is resumable — but only if it says so.
   */
  analyzedTo?: number;
  windows: SilenceWindow[];
  /**
   * Every instant a word was spoken, for a transcript map built from a
   * word-timed track. Seconds, sorted, two decimal places.
   *
   * Stored rather than recomputed because the veto in `vetoWords` has to run
   * against a map that came off disk — the reported bug is a *stored* ffmpeg map
   * skipping over "3." on a video opened for the second time, and a veto that
   * only worked after a caption fetch would arrive too late to stop it. It is
   * also what lets a phone apply the veto to an ffmpeg map a Mac computed and
   * iCloud carried.
   *
   * `pruneWordLists` keeps this off all but the most recent maps: it is by far
   * the largest thing in the file, and a video nobody has opened in months can
   * fetch its captions again in one request.
   */
  words?: number[];
  /**
   * The silence threshold this map was actually built at, in dBFS. ffmpeg only.
   *
   * Stored because it is the one number that decides whether a map is any good,
   * and because it used to be a *setting* rather than a measurement: every map
   * built before 022 came from a fixed −30 dB, which on ordinary speech sits
   * inside the words. A map with no `noiseDb` is therefore one of those, and
   * `isStale` throws it away rather than trusting it — see `pickThreshold`.
   */
  noiseDb?: number;
}

/** Everything known about one video: at most one map per producer. */
export interface VideoSilence {
  videoId: string;
  sources: Partial<Record<SilenceSource, SilenceMap>>;
}

export interface SilenceState {
  version: 2;
  maps: Record<string, VideoSilence>;
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
/**
 * 0.1 s in 015, and BarkernotBob heard it: *"it sometimes slightly cuts into the
 * speaking with the speed up right before it slows back down."* A caption cue's
 * stated start is only good to a few hundred milliseconds, and under 016's union
 * those loose caption boundaries are kept on purpose, so the margin has to cover
 * them rather than the tighter ones ffmpeg reports.
 */
export const LEAD_OUT_SECONDS = 0.25;

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
  return { version: 2, maps: {} };
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
    const entry = normalizeEntry(videoId, value);
    if (entry) state.maps[videoId] = entry;
  }
  return state;
}

/**
 * One video's entry, from either schema.
 *
 * A v1 entry *is* a map — `{source, minGap, windows}` — so it migrates by being
 * dropped into the slot it names. Nothing is lost and nothing is recomputed,
 * which matters because the other device may still be running v1 and writing
 * that shape into the same iCloud file for days.
 */
function normalizeEntry(videoId: string, value: unknown): VideoSilence | null {
  const raw = value as { sources?: unknown; source?: unknown } | null;
  if (!raw || typeof raw !== "object") return null;

  const entry: VideoSilence = { videoId, sources: {} };

  if (raw.sources && typeof raw.sources === "object") {
    for (const source of SILENCE_SOURCES) {
      const map = normalizeMap(videoId, (raw.sources as Record<string, unknown>)[source]);
      if (map && map.source === source) entry.sources[source] = map;
    }
  } else {
    const map = normalizeMap(videoId, raw);
    if (map) entry.sources[map.source] = map;
  }

  return Object.keys(entry.sources).length > 0 ? entry : null;
}

function normalizeMap(videoId: string, value: unknown): SilenceMap | null {
  const raw = value as Partial<SilenceMap> | null;
  if (!raw || typeof raw !== "object") return null;
  if (raw.source !== "transcript" && raw.source !== "ffmpeg") return null;
  if (typeof raw.computedAt !== "string") return null;
  if (typeof raw.minGap !== "number" || !Number.isFinite(raw.minGap)) return null;
  if (!Array.isArray(raw.windows)) return null;

  const map: SilenceMap = {
    videoId,
    source: raw.source,
    computedAt: raw.computedAt,
    minGap: raw.minGap,
    windows: sortWindows(raw.windows.filter(isWindow)),
  };
  if (typeof raw.analyzedTo === "number" && Number.isFinite(raw.analyzedTo)) {
    map.analyzedTo = Math.max(0, raw.analyzedTo);
  }
  if (Array.isArray(raw.words)) {
    const words = raw.words.filter((w): w is number => typeof w === "number" && Number.isFinite(w) && w >= 0);
    if (words.length) map.words = words.sort((a, b) => a - b);
  }
  if (typeof raw.noiseDb === "number" && Number.isFinite(raw.noiseDb)) {
    map.noiseDb = raw.noiseDb;
  }
  return map;
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

function sortWindows<T extends SilenceWindow>(windows: T[]): T[] {
  return [...windows].sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ producer

/** A caption line with both ends of its timing, in seconds. */
export interface TimedCue {
  start: number;
  end: number;
  text: string;
  /**
   * When the track has word-level timing, the second each word in this line
   * begins. Absolute video time, not an offset.
   *
   * Auto-generated json3 states one of these per word and 022 is built on them:
   * a caption *event* is a display instruction, so its stated duration is how
   * long the line stays on screen, not how long anyone spoke — which is why the
   * event-gap producer found almost nothing on `jlIDooGWXh0`. The words are the
   * only honest record of when speech actually happened, and they are already in
   * the file we fetch.
   *
   * Absent on human-written tracks, which state a line and no more.
   */
  words?: number[];
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

/**
 * How long a word is assumed to last, given that json3 states only where it
 * starts.
 *
 * This single number is what makes tier 0 conservative *by construction*. A word
 * whose start we know and whose end we do not cannot be allowed to end the
 * moment it began, or the producer would call the second half of every long word
 * silence. Half a second is longer than almost every English word at speech
 * rate, so the assumption errs towards "still talking" — which is the direction
 * that costs a skip rather than a syllable.
 *
 * It also raises the bar for what counts as a pause at all: with a 0.5 s
 * minimum, two word starts have to be a full second apart before anything is
 * skipped. That is the intended trade. A phone with no ffmpeg skips less and
 * never clips.
 */
export const WORD_ALLOWANCE = 0.5;

/** Every word instant in a set of cues, sorted, with duplicates collapsed. */
export function wordInstants(cues: TimedCue[]): number[] {
  const all: number[] = [];
  for (const cue of cues) {
    for (const word of cue.words ?? []) {
      if (Number.isFinite(word) && word >= 0) all.push(word);
    }
  }
  all.sort((a, b) => a - b);

  // Auto-captions repeat words across the rolling two-line events they use to
  // scroll the display, so the same instant arrives several times. 10 ms is far
  // under any real gap between two spoken words.
  const out: number[] = [];
  for (const word of all) {
    if (out.length === 0 || word - out[out.length - 1] > 0.01) out.push(word);
  }
  return out;
}

/**
 * Gaps between spoken words → silence windows. The tier 0 producer, and the one
 * that replaces caption-event gaps wherever word timing exists.
 *
 * The raw window is `[word + WORD_ALLOWANCE, nextWord]`: from where the word is
 * assumed to have finished, to where the next one demonstrably begins. It stops
 * *at* the next word rather than short of it because trimming is the apply
 * layer's job — `compressibleWindows` takes `LEAD_OUT_SECONDS` off every window
 * it hands to playback, and taking it off twice would be a margin nobody wrote
 * down.
 *
 * The stretch before the first word is included, exactly as `windowsFromCues`
 * includes it and for the same reason: it is a title card or an intro sting, and
 * compressing fluff is the point. The stretch after the last word is not — a
 * word with no successor states nothing about what follows it, and inventing a
 * window over the outro would be guessing.
 */
export function windowsFromWords(words: number[], minGap: number): SilenceWindow[] {
  const floor = Math.max(0, minGap);
  const sorted = [...words].sort((a, b) => a - b);
  const windows: SilenceWindow[] = [];

  let covered = 0;
  for (const word of sorted) {
    if (word - covered >= floor - EPSILON) windows.push({ start: covered, end: word });
    covered = Math.max(covered, word + WORD_ALLOWANCE);
  }
  return windows;
}

/**
 * The transcript producer's answer, from whichever timing the track actually
 * carries.
 *
 * Not a preference — a correctness split. On an auto-generated track the event
 * durations describe how long a line is *on screen*, which overlaps the next
 * line by design, so gaps between events barely exist: the measured count on
 * `jlIDooGWXh0` was zero windows from 354 events. Word instants are the real
 * signal there.
 *
 * A human-written track has no word timing at all, and its event durations are
 * honest — one line, one span, no overlap. Running the word producer on it would
 * see one "word" per line and call the whole of every spoken line a pause, which
 * is the worst failure this feature has. So the event-gap producer stays, for
 * exactly the tracks it was right about.
 */
export function transcriptWindows(cues: TimedCue[], minGap: number): SilenceWindow[] {
  const words = wordInstants(cues);
  // More instants than lines means the track is timing words rather than lines.
  // A one-to-one count is a human track, or an auto track stripped of `segs`.
  return words.length > cues.length
    ? windowsFromWords(words, minGap)
    : windowsFromCues(cues, minGap);
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
export function compressibleWindows<T extends SilenceWindow>(
  windows: T[],
  minGap: number,
): T[] {
  const floor = Math.max(0, minGap);
  const out: T[] = [];
  for (const window of windows) {
    if (window.end - window.start < floor - EPSILON) continue;
    const start = window.start + LEAD_IN_SECONDS;
    const end = window.end - LEAD_OUT_SECONDS;
    // A window whose margins meet is a pause too short to be worth entering:
    // the player would change rate twice for a few hundred milliseconds and the
    // only audible result would be the wobble.
    if (end - start <= 0) continue;
    // Spread rather than rebuilt, so a classified window keeps its `action`.
    out.push({ ...window, start, end });
  }
  return sortWindows(out);
}

/**
 * Windows that touch or overlap become one window.
 *
 * `JOIN_SECONDS` of slack rather than exact adjacency, because the two places
 * this is used both produce boundaries that *should* be the same instant and are
 * not: a pause straddling two analysis chunks comes back as two windows meeting
 * at the chunk edge, and a caption gap and an ffmpeg silence describing the same
 * pause disagree by a few tens of milliseconds. Leaving a 30 ms island of normal
 * speed between two compressed stretches would be audible as a stutter and would
 * save nothing.
 */
const JOIN_SECONDS = 0.05;

export function mergeWindows(windows: SilenceWindow[]): SilenceWindow[] {
  const sorted = sortWindows(windows.filter(isWindow));
  const out: SilenceWindow[] = [];
  for (const window of sorted) {
    const last = out[out.length - 1];
    if (last && window.start <= last.end + JOIN_SECONDS) {
      if (window.end > last.end) last.end = window.end;
      continue;
    }
    out.push({ start: window.start, end: window.end });
  }
  return out;
}

/**
 * Everything either producer calls quiet.
 *
 * The union is the whole of 016: caption timing answers "nobody is speaking" and
 * ffmpeg answers "nothing is audible", and BarkernotBob wants both skipped — a musical
 * interlude is silent to one and loud to the other, and it is still fluff. It
 * also makes an in-progress ffmpeg map safe by construction, which is what 015
 * got wrong: a partial map can only add windows here, never take the caption
 * map's away.
 */
export function unionWindows(...lists: SilenceWindow[][]): SilenceWindow[] {
  return mergeWindows(lists.flat());
}

/**
 * `primary` where it has looked, `fallback` beyond that.
 *
 * The other half of the new setting: with "skip non-speech" off, ffmpeg is
 * authoritative — a quiet interlude it has measured as loud must *not* be
 * compressed just because the captions had nothing to say there. But it is only
 * authoritative where it has actually run, so past `analyzedTo` the caption map
 * still applies. A fallback window straddling the frontier is cut at it rather
 * than dropped, so there is no unskippable seam.
 */
export function spliceAtFrontier(
  primary: SilenceWindow[],
  fallback: SilenceWindow[],
  frontier: number,
): SilenceWindow[] {
  const kept: SilenceWindow[] = [];
  for (const window of primary) {
    if (window.start >= frontier) continue;
    kept.push({ start: window.start, end: Math.min(window.end, frontier) });
  }
  for (const window of fallback) {
    if (window.end <= frontier) continue;
    kept.push({ start: Math.max(window.start, frontier), end: window.end });
  }
  return mergeWindows(kept);
}

/**
 * What playback does with a window, and the whole of issue 017.
 *
 * 015 and 016 had one answer — play it faster — and BarkernotBob's objection is that
 * you can *hear* faster. A pause played at 3× is 3× of something, and the ear
 * reads the seam either side of it as a glitch rather than as an edit. A pause
 * that is seeked over is silent by definition, so there is nothing to hear.
 *
 * `speed` survives for exactly one case: audio that is not speech but is not
 * silence either — a musical interlude, a demo, a room tone the mix wants you to
 * feel. BarkernotBob's words: *"Instrumentals can ff."* Cutting it outright would edit
 * the video rather than tighten it; playing it fast keeps the fact that it
 * happened.
 */
export type SilenceAction = "skip" | "speed";

/** A window with playback's decision already attached. */
export interface PlaybackWindow extends SilenceWindow {
  action: SilenceAction;
}

/**
 * Shorter than this and a seek costs more than it saves.
 *
 * A seek is not free: the element fires `seeking`, drops the current decode, and
 * on a streamed source may re-request. Under a third of a second the whole thing
 * would be one click in place of one gap, and the gap was the quieter of the
 * two. Anything below the floor is left alone — see `moveFor`, which used to
 * play it fast instead and is where 022's chipmunk came from.
 */
export const MIN_SKIP_SECONDS = 0.35;

/** What playback should compress, and which producer to credit for it. */
export interface CombinedSilence {
  windows: PlaybackWindow[];
  source: SilenceSource | null;
}

/** Tag a plain list with one action. */
function tag(windows: SilenceWindow[], action: SilenceAction): PlaybackWindow[] {
  return windows.map((window) => ({ start: window.start, end: window.end, action }));
}

/** The parts of `from` that no window in `holes` covers. Both must be merged. */
export function subtractWindows(
  from: SilenceWindow[],
  holes: SilenceWindow[],
): SilenceWindow[] {
  const out: SilenceWindow[] = [];
  for (const window of from) {
    let cursor = window.start;
    for (const hole of holes) {
      if (hole.end <= cursor) continue;
      if (hole.start >= window.end) break;
      if (hole.start > cursor) out.push({ start: cursor, end: hole.start });
      cursor = Math.max(cursor, hole.end);
      if (cursor >= window.end) break;
    }
    if (window.end > cursor) out.push({ start: cursor, end: window.end });
  }
  return out.filter((window) => window.end - window.start > EPSILON);
}

/**
 * How much room a word is given on each side of the instant it starts.
 *
 * Not a word length — `WORD_ALLOWANCE` is that. This is the uncertainty in the
 * timestamp itself: YouTube's recogniser states word starts to a few tens of
 * milliseconds, and a skip that lands 50 ms into a word is still a clipped word.
 * 0.2 s is the default and it is a setting, in the Advanced section, because
 * lowering it is exactly the trade the warning there describes.
 */
export const WORD_PAD = 0.2;

/**
 * Take every spoken word back out of the windows about to be skipped. **Words
 * veto silence, and this is principle 4 of issue 022.**
 *
 * Detection can be wrong in a way that is inaudible (a pause called speech, so
 * nothing is skipped) or in a way you can hear (speech called a pause, so a word
 * disappears). This function makes the second one impossible for any word the
 * captions know about: `jlIDooGWXh0` had "3." at 278.32 inside an ffmpeg window
 * of 277.94–278.99, and the skip jumped clean over it. The captions had the word
 * the whole time.
 *
 * It is not a substitute for calibrating the threshold — a video with no
 * captions gets nothing from it, and even here the mis-detected windows still
 * cost their pause. It is the backstop that holds when the measurement is wrong,
 * which is why it runs at combine time: it covers stored maps, live batches and
 * the ffmpeg maps a Mac computes and a phone reads through iCloud, in one place.
 *
 * Linear in both lists rather than an `n × m` subtraction, because it runs on
 * every batch of an ffmpeg analysis and a long video has thousands of each.
 */
export function vetoWords<T extends SilenceWindow>(
  windows: T[],
  words: number[],
  pad = WORD_PAD,
): T[] {
  if (words.length === 0) return windows;
  const margin = Math.max(0, pad);
  const out: T[] = [];
  // Both lists are sorted, so this only ever moves forward — a word that ends
  // before this window starts ends before every later window starts too.
  let first = 0;

  for (const window of windows) {
    while (first < words.length && words[first] + margin <= window.start) first++;

    let cursor = window.start;
    for (let i = first; i < words.length && words[i] - margin < window.end; i++) {
      const from = words[i] - margin;
      const to = words[i] + margin;
      if (from > cursor) keep(out, window, cursor, from);
      cursor = Math.max(cursor, to);
      if (cursor >= window.end) break;
    }
    if (window.end > cursor) keep(out, window, cursor, window.end);
  }
  return out;
}

/**
 * A surviving fragment, if it is still worth anything.
 *
 * Under `MIN_SKIP_SECONDS` the player would decline to seek it anyway and —
 * since 022 — do nothing at all, so carrying it forward would only mean a
 * shorter map saying the same thing. Dropped here so the count in the readout
 * and the windows on the map agree.
 */
function keep<T extends SilenceWindow>(out: T[], window: T, start: number, end: number): void {
  if (end - start >= MIN_SKIP_SECONDS) out.push({ ...window, start, end });
}

/** The part of each window on one side of `frontier`. */
function clip(windows: SilenceWindow[], frontier: number, side: "before" | "after"): SilenceWindow[] {
  const out: SilenceWindow[] = [];
  for (const window of windows) {
    const start = side === "before" ? window.start : Math.max(window.start, frontier);
    const end = side === "before" ? Math.min(window.end, frontier) : window.end;
    if (end - start > EPSILON) out.push({ start, end });
  }
  return out;
}

/**
 * The one place the two producers are reconciled — the decision `player.ts` used
 * to make by accident, by keeping whichever map arrived last.
 *
 * With `skipNonSpeech` on (the default, and BarkernotBob's ask) it is the union:
 * everything either producer calls quiet. Off, it is 015's rule — ffmpeg's
 * measurement wins where it has run, captions cover the rest — and that is the
 * setting to reach for if a video's music starts getting eaten.
 *
 * Either way an ffmpeg analysis that is still running can only improve the
 * answer, which is the property 015 lacked and BarkernotBob hit within a minute.
 */
export function combineSilence(opts: {
  transcript?: SilenceMap | null;
  ffmpeg?: { windows: SilenceWindow[]; analyzedTo?: number } | null;
  skipNonSpeech: boolean;
  /**
   * Every instant a word was spoken, if the captions state them. Nothing that
   * contains one of these is ever skipped — see `vetoWords`.
   */
  words?: number[] | null;
  wordPad?: number;
}): CombinedSilence {
  const transcript = mergeWindows(opts.transcript?.windows ?? []);
  const ffmpeg = mergeWindows(opts.ffmpeg?.windows ?? []);
  const haveFfmpeg = !!opts.ffmpeg;

  // Applied to every route out of this function, and only to the windows that
  // get *skipped*: an instrumental is played, not cut, so a word inside one is
  // heard either way. The word list is usually the transcript map's own, which
  // makes the veto a near no-op on transcript windows — they were built from the
  // same words — and the whole of the safety net on ffmpeg's.
  const veto = <T extends SilenceWindow>(windows: T[]): T[] =>
    vetoWords(windows, opts.words ?? [], opts.wordPad ?? WORD_PAD);

  // Captions alone cannot tell a pause from an interlude — "nobody is speaking"
  // is the only question they answer — so every window is skipped. That is the
  // phone's whole story, and the Mac's until ffmpeg is installed.
  if (!haveFfmpeg) {
    return {
      windows: veto(tag(transcript, "skip")),
      source: opts.transcript ? "transcript" : null,
    };
  }

  const frontier = opts.ffmpeg?.analyzedTo ?? Number.POSITIVE_INFINITY;

  if (!opts.skipNonSpeech) {
    return {
      windows: veto(tag(spliceAtFrontier(ffmpeg, transcript, frontier), "skip")),
      source: "ffmpeg",
    };
  }

  // The union, split by what each half of it means. ffmpeg measured no audio, so
  // those windows are silence and go. A caption gap ffmpeg has *looked at* and
  // found audible is the instrumental case, and that is the only thing that gets
  // played fast rather than cut. Past the frontier ffmpeg has not looked yet, so
  // a caption gap there is treated exactly as it is on a machine with no ffmpeg
  // at all — skipped — rather than guessed at.
  const unlooked = clip(transcript, frontier, "after");
  const instrumental = subtractWindows(clip(transcript, frontier, "before"), ffmpeg);
  const windows = sortWindows([
    ...veto(tag(unionWindows(ffmpeg, unlooked), "skip")),
    ...tag(instrumental, "speed"),
  ]);
  return { windows, source: "ffmpeg" };
}

/**
 * What the player should do at this instant: nothing, go faster, or jump.
 *
 * The one function the whole of 017 turns on, and pure for the same reason
 * `rateFor` was — a decision this small, made 60 times a second, has to be
 * testable without a `<video>`.
 *
 * A skip reports where to land rather than performing one, because the player is
 * allowed to veto it: the target has to be buffered, or the jump trades a pause
 * you can hear for a stall you can watch.
 */
export type PlaybackMove =
  | { kind: "rate"; rate: number }
  | { kind: "skip"; to: number; rate: number };

export function moveFor(
  seconds: number,
  windows: PlaybackWindow[],
  baseRate: number,
  silenceRate: number,
): PlaybackMove {
  const window = windows.length === 0 ? null : windowAt(windows, seconds);
  if (!window) return { kind: "rate", rate: baseRate };

  // `max`, not the silence rate outright: someone listening at 2× has already
  // said they want to go faster than 1.5×, and an interlude is never the moment
  // to slow down. This is the *only* path to the fast rate now, and 022 is the
  // reason: 3× is reserved for a window positively classified as instrumental —
  // ffmpeg heard audio there and the captions know no words were spoken. Every
  // other uncertainty below hands back the base rate. Chipmunk on music is the
  // feature; chipmunk on speech is the bug, and a "skip" window we decline to
  // skip is exactly the case where the classification might be wrong.
  const fast = Math.max(baseRate, silenceRate);
  if (window.action !== "skip") return { kind: "rate", rate: fast };

  // Too little left to be worth a seek — either a short window, or one we are
  // already most of the way through because the map arrived mid-pause. This
  // remnant is the chipmunk BarkernotBob heard on "and his name": a detection error
  // trimmed to 0.30 s, under the floor, and the old code played it at 3×. Doing
  // nothing is silent when the window is real and inaudible when it is not.
  if (window.end - seconds < MIN_SKIP_SECONDS) return { kind: "rate", rate: baseRate };
  return { kind: "skip", to: window.end, rate: baseRate };
}

/**
 * Listening time a skip buys, in the same units the readout already counts.
 *
 * `secondsSaved` measures wall clock at the user's chosen speed, so a jump over
 * `mediaSeconds` of video saves the time those seconds would have taken to play:
 * `mediaSeconds / baseRate`. At 1× a 3 s pause skipped reports 3 s, against the
 * 2 s the same pause reported at 3× — which is the point of the change.
 */
export function secondsSkipped(mediaSeconds: number, baseRate: number): number {
  if (baseRate <= 0 || mediaSeconds <= 0) return 0;
  return mediaSeconds / baseRate;
}

/** Shift a chunk's windows into whole-video time. See `planChunks`. */
export function offsetWindows(windows: SilenceWindow[], delta: number): SilenceWindow[] {
  if (!delta) return [...windows];
  return windows.map((w) => ({ start: Math.max(0, w.start + delta), end: w.end + delta }));
}

/** One unit of work for the ffmpeg producer: `[start, end)` of the video. */
export interface SilenceChunk {
  start: number;
  end: number;
}

/**
 * Split a video into analysis chunks, nearest the playhead first.
 *
 * Three things are load-bearing here, and all three are measurements rather than
 * taste (2026-07-29, real audio URL):
 *
 * - **Chunks exist at all** because googlevideo throttles *per connection*. One
 *   stream analyses at 1.9× realtime — slower than BarkernotBob watches — while six
 *   parallel chunks manage ~10×. This is the fix for "nothing is skipped": the
 *   map could never get ahead of the playhead.
 * - **`from` orders the work outward from where playback is**, so the minute
 *   being watched is analysed first and the credits last. Chunks before `from`
 *   are not dropped — a rewind should not hit a hole — they go to the back.
 * - **`overlap`** because silencedetect only reports a silence it sees both ends
 *   of. A pause lying across a chunk boundary would otherwise come back as two
 *   halves, each possibly under the user's threshold, and vanish. Overlapping
 *   makes some pause wholly visible to one chunk or the other, and `mergeWindows`
 *   glues the duplicates back together.
 */
export function planChunks(
  duration: number,
  from: number,
  chunkSeconds: number,
  overlap: number,
): SilenceChunk[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const size = Math.max(1, chunkSeconds);
  const pad = Math.max(0, overlap);
  const count = Math.ceil(duration / size);
  const chunks: SilenceChunk[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push({ start: i * size, end: Math.min(duration, (i + 1) * size + pad) });
  }

  const start = Math.min(count - 1, Math.max(0, Math.floor(Math.max(0, from) / size)));
  return [...chunks.slice(start), ...chunks.slice(0, start)];
}

/**
 * Is `seconds` inside one of these windows? Binary search, because this is
 * called once per animation frame against a map that can hold a few thousand
 * windows for a long video.
 */
export function windowAt<T extends SilenceWindow>(windows: T[], seconds: number): T | null {
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
 *
 * The second rule is 022's migration, and it is a one-off: an ffmpeg map with
 * no `noiseDb` was built before the threshold was measured, which means it was
 * built at the fixed −30 dB that put skip windows inside the words. Those maps
 * are wrong rather than coarse, so they are discarded and recomputed rather
 * than filtered.
 */
export function isStale(map: SilenceMap, minGap: number): boolean {
  if (map.minGap > minGap + EPSILON) return true;
  return map.source === "ffmpeg" && map.noiseDb === undefined;
}

/**
 * Should `incoming` replace `existing`, within the one source's slot?
 *
 * Cross-source ranking is gone with 015's premise — the two producers no longer
 * compete for one slot, so this only ever compares like with like. A finer floor
 * beats a coarser one (it strictly contains it); then **more of the video
 * analysed** beats less, which is what stops a note closed after twenty seconds
 * from replacing a complete map with its own stub; then recency decides.
 */
export function isBetterMap(incoming: SilenceMap, existing: SilenceMap | undefined): boolean {
  if (!existing) return true;
  if (incoming.source !== existing.source) return false;
  if (Math.abs(incoming.minGap - existing.minGap) > EPSILON) {
    return incoming.minGap < existing.minGap;
  }
  const reach = analyzedReach(incoming) - analyzedReach(existing);
  if (Math.abs(reach) > EPSILON) return reach > 0;
  return incoming.computedAt > existing.computedAt;
}

/** How far a map claims to have looked. A complete map reaches everywhere. */
function analyzedReach(map: SilenceMap): number {
  return map.analyzedTo ?? Number.POSITIVE_INFINITY;
}

/**
 * Fold new maps into the state, in place. Returns whether anything changed.
 *
 * This is a merge and not an assignment for the reason issue 014 cost a day of
 * hidden videos coming back: the file is written by a Mac and an iPhone against
 * the same iCloud folder, so the last writer holding a whole-file snapshot
 * silently deletes whatever the other one added. Re-read, union by video ID and
 * then by source, let `isBetterMap` arbitrate — then write. Merging per source
 * is what lets the Mac's ffmpeg map and the phone's caption map coexist for the
 * same video instead of overwriting each other on every sync.
 */
export function mergeSilenceMaps(state: SilenceState, incoming: SilenceMap[]): boolean {
  let changed = false;
  for (const map of incoming) {
    const entry = (state.maps[map.videoId] ??= { videoId: map.videoId, sources: {} });
    if (!isBetterMap(map, entry.sources[map.source])) continue;
    entry.sources[map.source] = map;
    changed = true;
  }
  return changed;
}

/** The most recent thing known about a video, for pruning. */
function entryComputedAt(entry: VideoSilence): string {
  let latest = "";
  for (const map of Object.values(entry.sources)) {
    if (map && map.computedAt > latest) latest = map.computedAt;
  }
  return latest;
}

/**
 * Keep the file small. Maps are a few hundred bytes each, so the cap is about
 * not letting a sync file grow without bound rather than about disk.
 */
export function pruneSilenceMaps(state: SilenceState, max = MAX_SILENCE_MAPS): boolean {
  const ids = Object.keys(state.maps);
  if (ids.length <= max) return false;
  const doomed = ids
    .sort((a, b) => entryComputedAt(state.maps[a]).localeCompare(entryComputedAt(state.maps[b])))
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

// -------------------------------------------------------------- calibration

/**
 * The threshold to use when calibration could not run, in dBFS.
 *
 * −45 and not −30, deliberately: an under-detecting threshold costs a few
 * skipped pauses, and an over-detecting one talks over the words. The old −30
 * default is the bug in 022 and is never a fallback.
 */
export const UNCALIBRATED_NOISE_DB = -45;
/** How far above the measured noise floor the threshold sits. */
export const FLOOR_MARGIN_DB = 8;
/** How far below the measured speech level it must stay, whatever the floor says. */
export const SPEECH_GUARD_DB = 20;
/** Nothing outside this is a plausible speech/silence boundary. */
export const THRESHOLD_MIN_DB = -60;
export const THRESHOLD_MAX_DB = -25;
/**
 * Below this a window is digital silence, not a noise floor.
 *
 * Gated or denoised audio reads −90 dB or −inf between phrases, and a threshold
 * anchored there detects nothing at all. Those windows are dropped from the
 * floor estimate so the floor lands on real room tone — or, on a hard-gated
 * track where there *is* no room tone, on speech, where `SPEECH_GUARD_DB` takes
 * over and produces a usable threshold anyway.
 */
export const GATED_FLOOR_DB = -90;
/** Fewer measurements than this is not a distribution worth reading. */
const MIN_CALIBRATION_SAMPLES = 100;

export interface ThresholdChoice {
  /** dBFS, ready to hand to `silencedetect=noise=`. */
  thresholdDb: number;
  /** Whether the audio was measured, or this is `UNCALIBRATED_NOISE_DB`. */
  calibrated: boolean;
  /** The measured bands, for the console line that explains a surprising map. */
  floorDb?: number;
  speechDb?: number;
  samples: number;
}

/**
 * Peak levels out of `astats`, one per analysis window.
 *
 * ffmpeg prints them through `ametadata=mode=print` as one `key=value` line
 * each, interleaved with everything else on stderr:
 *
 * ```
 * frame:0    pts:0       pts_time:0
 * lavfi.astats.Overall.Peak_level=-38.472656
 * ```
 *
 * **Peak** and not RMS, which is the whole reason this parser exists rather
 * than an easier one: `silencedetect` compares individual samples against its
 * threshold, so an RMS series measured over the same window sits systematically
 * below what the detector actually reacts to. Calibrating a peak-based detector
 * on RMS produced −48 dB on the video in 022 where the right answer was −36,
 * and −48 found four silences in twenty-six minutes.
 *
 * A gated stretch prints `-inf`, which parses to `-Infinity` and is kept: it is
 * a real measurement, and `pickThreshold` is the one that decides what to do
 * with it.
 */
export function parseAstatsPeaks(text: string): number[] {
  const levels: number[] = [];
  for (const match of text.matchAll(/Peak_level=(-?[\d.]+|-inf|inf|nan)/gi)) {
    const raw = match[1].toLowerCase();
    if (raw === "nan") continue;
    levels.push(raw === "-inf" ? -Infinity : raw === "inf" ? Infinity : Number(raw));
  }
  return levels.filter((v) => !Number.isNaN(v));
}

/** The value at `q` of a sorted-ascending copy of `values`. */
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round(q * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

/**
 * Where silence ends and speech begins, for this video's audio.
 *
 * The failure 022 was written about is a fixed threshold: −30 dB is inside the
 * words on a normally-mastered voice track, so silencedetect reported the gaps
 * *between syllables* as silence and the player skipped them. Every recording
 * has its own floor, so the threshold has to be measured rather than chosen.
 *
 * Two constraints, and the lower wins:
 *
 * - **`floor + FLOOR_MARGIN_DB`** — a few dB above the quietest thing in the
 *   audio, which is what "silence" means here.
 * - **`speech − SPEECH_GUARD_DB`** — never near the words, whatever the floor
 *   turned out to be. This is what rescues hard-gated audio, whose floor is
 *   digital zero and whose `floor + margin` would detect nothing.
 *
 * The floor is the 5th percentile rather than the minimum because one glitchy
 * window should not set it, and speech is the 90th rather than the maximum for
 * the same reason at the other end.
 */
export function pickThreshold(
  peaks: number[],
  floorMargin: number = FLOOR_MARGIN_DB,
): ThresholdChoice {
  const finite = peaks.filter((v) => Number.isFinite(v));
  if (finite.length < MIN_CALIBRATION_SAMPLES) {
    return { thresholdDb: UNCALIBRATED_NOISE_DB, calibrated: false, samples: finite.length };
  }

  const audible = finite.filter((v) => v > GATED_FLOOR_DB);
  const floorDb = percentile(audible.length ? audible : finite, 0.05);
  const speechDb = percentile(finite, 0.9);

  const raw = Math.min(floorDb + floorMargin, speechDb - SPEECH_GUARD_DB);
  const thresholdDb = Math.round(Math.min(THRESHOLD_MAX_DB, Math.max(THRESHOLD_MIN_DB, raw)) * 10) / 10;
  return { thresholdDb, calibrated: true, floorDb, speechDb, samples: finite.length };
}
