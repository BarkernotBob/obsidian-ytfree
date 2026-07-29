/**
 * Where you got to in each video.
 *
 * A note is reopened far more often than a video is finished — you watch ten
 * minutes on the phone, close it, and come back on the Mac — and until now
 * every one of those returns started at 0:00 and had to be scrubbed back by
 * hand. This is the record that stops that.
 *
 * Deliberately not in the note's frontmatter. A position changes every few
 * seconds while something is playing, and writing that into the note would
 * rewrite a synced file continuously, produce iCloud conflict copies, and put a
 * document change under the cursor of anyone typing in the note at the time.
 * It lives in its own file beside `subscriptions.json` instead, keyed by video
 * rather than by note — the same video watched from two notes is one position,
 * which is the answer you want.
 *
 * Pure and platform-neutral: no `obsidian` import, no Node builtin. The file
 * I/O is `ProgressStore` in `main.ts`; everything that decides anything is
 * here, so it is all testable under plain `node --test`.
 */

/** How far in you have to be before a position is worth remembering. */
export const MIN_REMEMBER_SECONDS = 15;

/**
 * How close to the end counts as finished.
 *
 * Both halves are needed: 20 seconds is nothing in a two-hour talk, and 3% is
 * nothing in a 90-second clip. Whichever is more generous wins, so a video is
 * finished when the only thing left is the outro either way.
 */
export const END_MARGIN_SECONDS = 20;
export const END_MARGIN_FRACTION = 0.03;

/** Entries older than this are dropped on load. */
export const PROGRESS_TTL_DAYS = 365;

/** And the file never grows past this, oldest first. */
export const MAX_PROGRESS_ENTRIES = 2000;

export interface WatchPoint {
  /** Whole seconds; sub-second precision is noise in a resume point. */
  seconds: number;
  /** ISO 8601, so the file is readable and the prune has something to sort on. */
  updatedAt: string;
}

export interface ProgressState {
  positions: Record<string, WatchPoint>;
}

export function emptyProgress(): ProgressState {
  return { positions: {} };
}

/**
 * Read whatever is in the file without trusting any of it.
 *
 * The file is written by us, but it is also synced, hand-editable and
 * occasionally truncated by a crash mid-write. Anything that is not a finite
 * positive number with a parseable date is dropped rather than carried into
 * memory, because the one thing this must never do is seek a player to `NaN`.
 */
export function normalizeProgress(raw: unknown): ProgressState {
  const state = emptyProgress();
  const positions = (raw as ProgressState | null)?.positions;
  if (!positions || typeof positions !== "object") return state;

  for (const [videoId, value] of Object.entries(positions)) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
    const seconds = Math.floor(Number((value as WatchPoint)?.seconds));
    if (!Number.isFinite(seconds) || seconds < MIN_REMEMBER_SECONDS) continue;
    const updatedAt = String((value as WatchPoint)?.updatedAt ?? "");
    if (!Number.isFinite(Date.parse(updatedAt))) continue;
    state.positions[videoId] = { seconds, updatedAt };
  }
  return state;
}

/**
 * Note where a video has got to, and answer whether anything changed.
 *
 * The return value is what keeps this off the disk: a `timeupdate` that moved
 * the remembered second by nothing at all should not write a file. Three
 * outcomes, not two — a position near the end *removes* the entry, because a
 * finished video should reopen at the start rather than at its own credits.
 *
 * `duration` may be 0 or NaN: a stream that has not reported metadata yet has
 * no end to be near, so the finished test simply does not apply.
 */
export function recordPosition(
  state: ProgressState,
  videoId: string,
  seconds: number,
  duration: number,
  now: Date,
): boolean {
  if (!videoId) return false;
  const at = Math.floor(seconds);
  if (!Number.isFinite(at)) return false;

  if (at < MIN_REMEMBER_SECONDS || isFinished(at, duration)) {
    return clearPosition(state, videoId);
  }

  const existing = state.positions[videoId];
  if (existing && existing.seconds === at) return false;
  state.positions[videoId] = { seconds: at, updatedAt: now.toISOString() };
  return true;
}

export function isFinished(seconds: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const margin = Math.max(END_MARGIN_SECONDS, duration * END_MARGIN_FRACTION);
  return seconds >= duration - margin;
}

export function clearPosition(state: ProgressState, videoId: string): boolean {
  if (!(videoId in state.positions)) return false;
  delete state.positions[videoId];
  return true;
}

/** Where to pick this video up, or 0 for "from the start". */
export function resumePoint(state: ProgressState, videoId: string): number {
  return state.positions[videoId]?.seconds ?? 0;
}

/**
 * Drop what has gone stale and cap what is left, oldest first.
 *
 * Nothing here is precious — the worst case of pruning too hard is one video
 * that starts at 0:00 — so it is applied on load and never asked about again.
 */
export function pruneProgress(state: ProgressState, now: Date, ttlDays = PROGRESS_TTL_DAYS): boolean {
  const cutoff = now.getTime() - ttlDays * 86_400_000;
  let changed = false;

  const entries = Object.entries(state.positions).filter(([videoId, point]) => {
    if (Date.parse(point.updatedAt) >= cutoff) return true;
    delete state.positions[videoId];
    changed = true;
    return false;
  });

  if (entries.length > MAX_PROGRESS_ENTRIES) {
    entries.sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));
    for (const [videoId] of entries.slice(0, entries.length - MAX_PROGRESS_ENTRIES)) {
      delete state.positions[videoId];
      changed = true;
    }
  }
  return changed;
}
