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
  /**
   * How long the video runs, as the player measured it. Absent on every entry
   * written before the In progress list existed, and on any report that arrived
   * before the stream announced a duration.
   *
   * Recorded here rather than read back off the hub item because this is the
   * number the player actually saw: a hub item's `durationSeconds` is
   * `undefined` until a poll backfills it, and a Watch Later item may never get
   * one at all. See `inProgressVideos`.
   */
  duration?: number;
}

/**
 * How often the "you watched this" stamp is allowed to move.
 *
 * It exists for the month-long tidy in `tidy.ts`, which cannot tell an hour
 * from a minute, so rewriting it on every progress report would be a change
 * every five seconds for nothing.
 */
export const WATCH_STAMP_INTERVAL_MS = 3_600_000;

export interface ProgressState {
  positions: Record<string, WatchPoint>;
  /**
   * ISO time each video was last played, kept apart from `positions` because
   * the two answer different questions and die at different moments: a position
   * is erased the second the video finishes, and "you watched this" is exactly
   * the fact that a finished video should still carry.
   */
  watched: Record<string, string>;
  /**
   * When each video's position was last *cleared* — finished, or scrubbed back
   * under `MIN_REMEMBER_SECONDS`. Without it a clear could not cross devices:
   * an absence reads as "never seen", so the other device's older position came
   * back and the video reopened near its end (V1-SCOPE-SYNC). A position newer
   * than its clear wins, and the clear is dropped once it has lost.
   */
  cleared: Record<string, string>;
  /**
   * Watch stamps already handed to `history.json` (GitHub #48), by the stamp
   * that was handed over. A stamp at or before its entry here is dropped on
   * every merge, so the other device's copy cannot hand it back and set off
   * the hand-over again on every save.
   */
  drained: Record<string, string>;
}

export function emptyProgress(): ProgressState {
  return { positions: {}, watched: {}, cleared: {}, drained: {} };
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
  const watched = (raw as ProgressState | null)?.watched;

  if (positions && typeof positions === "object") {
    for (const [videoId, value] of Object.entries(positions)) {
      if (!VIDEO_ID_RE.test(videoId)) continue;
      const seconds = Math.floor(Number(value?.seconds));
      if (!Number.isFinite(seconds) || seconds < MIN_REMEMBER_SECONDS) continue;
      const updatedAt = String(value?.updatedAt ?? "");
      if (!Number.isFinite(Date.parse(updatedAt))) continue;
      const duration = Number(value?.duration);
      state.positions[videoId] =
        Number.isFinite(duration) && duration > 0
          ? { seconds, updatedAt, duration }
          : { seconds, updatedAt };
    }
  }

  for (const key of ["cleared", "drained"] as const) {
    const list = (raw as ProgressState | null)?.[key];
    if (!list || typeof list !== "object" || Array.isArray(list)) continue;
    for (const [videoId, value] of Object.entries(list)) {
      if (!VIDEO_ID_RE.test(videoId)) continue;
      const at = String(value ?? "");
      if (Number.isFinite(Date.parse(at))) state[key][videoId] = at;
    }
  }

  if (watched && typeof watched === "object") {
    for (const [videoId, value] of Object.entries(watched)) {
      if (!VIDEO_ID_RE.test(videoId)) continue;
      const at = String(value ?? "");
      // A stamp nobody can parse is worse than none: it decides whether a note
      // is a month old, and the answer to "I cannot tell" must be "leave it".
      if (!Number.isFinite(Date.parse(at))) continue;
      state.watched[videoId] = at;
    }
  }
  return state;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

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

  const finished = isFinished(at, duration);
  if (at < MIN_REMEMBER_SECONDS || finished) {
    if (videoId in state.positions) return clearPosition(state, videoId, now);
    // Finished here before the other device's position arrived: the clear
    // still has to be said, or that older position wins when it lands. At
    // most once a minute — the credits report every few seconds.
    const lastClear = Date.parse(state.cleared[videoId] ?? "");
    if (finished && !(now.getTime() - lastClear < CLEAR_RESTAMP_MS)) {
      state.cleared[videoId] = now.toISOString();
      return true;
    }
    return false;
  }

  const existing = state.positions[videoId];
  // The duration is worth writing even when the second has not moved: a report
  // that finally knows how long the video is turns an entry the In progress
  // list had to skip into one it can judge.
  const known = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined;
  if (existing && existing.seconds === at && (known === undefined || existing.duration === known)) {
    return false;
  }
  delete state.cleared[videoId];
  state.positions[videoId] = {
    seconds: at,
    updatedAt: now.toISOString(),
    ...(known !== undefined ? { duration: known } : existing?.duration !== undefined
      ? { duration: existing.duration }
      : {}),
  };
  return true;
}

// ------------------------------------------------------------- in progress

/**
 * How far in you have to be before a video counts as *started* rather than
 * *glanced at*.
 *
 * Two minutes, or a tenth of the video, whichever is **smaller** — so a
 * 40-minute lecture qualifies two minutes in, and a five-minute clip at thirty
 * seconds. A single flat number cannot do both: 2 minutes of a 3-minute video
 * is most of it, and 10% of a 3-hour talk is eighteen minutes.
 */
export const IN_PROGRESS_FLOOR_SECONDS = 120;
export const IN_PROGRESS_FLOOR_FRACTION = 0.1;

/** The floor for one video, or null when its length is not known. */
export function inProgressFloor(duration: number | null | undefined): number | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.min(duration * IN_PROGRESS_FLOOR_FRACTION, IN_PROGRESS_FLOOR_SECONDS);
}

/**
 * Which videos you are part-way through, and when you last watched each.
 *
 * A stored position *is* the whole definition: `recordPosition` deletes the
 * entry the moment `isFinished` says so, and has since 012, so a finished video
 * cannot appear here and there is no second opinion about what "done" means.
 * This only adds the floor.
 *
 * A video whose length nobody knows is **left out** rather than guessed at. The
 * length is taken from the entry itself first — that is what the player
 * measured — and from `durationFor` only as a fallback, for entries written
 * before the field existed.
 */
export function inProgressVideos(
  state: ProgressState,
  durationFor: (videoId: string) => number | null | undefined,
): Map<string, string> {
  const found = new Map<string, string>();
  for (const [videoId, point] of Object.entries(state.positions)) {
    const floor = inProgressFloor(point.duration ?? durationFor(videoId));
    if (floor === null || point.seconds < floor) continue;
    found.set(videoId, point.updatedAt);
  }
  return found;
}

/**
 * Note that this video was played, and answer whether anything changed.
 *
 * Called from the same report as `recordPosition` and kept separate from it on
 * purpose: a position that has reached the credits is deleted, and this is the
 * record that has to outlive that. Rate-limited to one move an hour, which is
 * far finer than the only thing that reads it.
 */
export function markWatched(state: ProgressState, videoId: string, now: Date): boolean {
  if (!videoId) return false;
  const previous = Date.parse(state.watched[videoId] ?? "");
  if (Number.isFinite(previous) && now.getTime() - previous < WATCH_STAMP_INTERVAL_MS) {
    return false;
  }
  state.watched[videoId] = now.toISOString();
  return true;
}

/** When this video was last played, or null. */
export function watchedAt(state: ProgressState, videoId: string): string | null {
  return state.watched[videoId] ?? null;
}

/** How often a finish with nothing to clear may restamp its clear. */
const CLEAR_RESTAMP_MS = 60_000;

export function isFinished(seconds: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const margin = Math.max(END_MARGIN_SECONDS, duration * END_MARGIN_FRACTION);
  return seconds >= duration - margin;
}

export function clearPosition(state: ProgressState, videoId: string, now = new Date()): boolean {
  if (!(videoId in state.positions)) return false;
  delete state.positions[videoId];
  state.cleared[videoId] = now.toISOString();
  return true;
}

/** Where to pick this video up, or 0 for "from the start". */
export function resumePoint(state: ProgressState, videoId: string): number {
  return state.positions[videoId]?.seconds ?? 0;
}

/**
 * Fold another device's copy of the file into this one.
 *
 * The reason this exists at all: the store used to read the file once, at load,
 * and write its whole snapshot back from then on. A Mac left open all day
 * therefore never saw a position the phone wrote at lunchtime — and worse, the
 * next thing it wrote put its own morning snapshot back over it. Progress
 * appeared to sync one way only, which is exactly what it was doing.
 *
 * Newest wins, per video, on the stamp each entry already carries. Both files
 * are the same shape and neither is authoritative: whichever device last
 * *watched* a video knows where it got to, and that is what `updatedAt`
 * records.
 *
 * A finished video's position is removed rather than zeroed, and an absence
 * reads as "never seen" — so the clear is carried as its own dated entry in
 * `cleared`, and wins against any position not newer than it.
 */
export function mergeProgress(mine: ProgressState, theirs: ProgressState): ProgressState {
  const merged = emptyProgress();

  // Ties broken by the larger second, so both devices pick the same entry and
  // never rewrite the file back and forth over it (V1-SCOPE-SYNC).
  for (const [videoId, point] of Object.entries(mine.positions)) merged.positions[videoId] = point;
  for (const [videoId, point] of Object.entries(theirs.positions)) {
    const ours = merged.positions[videoId];
    if (
      !ours ||
      newer(point.updatedAt, ours.updatedAt) ||
      (point.updatedAt === ours.updatedAt && pointKey(point) > pointKey(ours))
    ) {
      merged.positions[videoId] = point;
    }
  }

  for (const [videoId, at] of Object.entries(mine.watched)) merged.watched[videoId] = at;
  for (const [videoId, at] of Object.entries(theirs.watched)) {
    const ours = merged.watched[videoId];
    if (!ours || newer(at, ours)) merged.watched[videoId] = at;
  }

  for (const list of [mine.drained ?? {}, theirs.drained ?? {}]) {
    for (const [videoId, at] of Object.entries(list)) {
      const seen = merged.drained[videoId];
      if (!seen || newer(at, seen)) merged.drained[videoId] = at;
    }
  }
  for (const [videoId, at] of Object.entries(merged.drained)) {
    const stamp = merged.watched[videoId];
    if (stamp !== undefined && !newer(stamp, at)) delete merged.watched[videoId];
  }

  // A clear beats any position it is not older than; a position recorded after
  // it wins, and the clear has done its job.
  for (const list of [mine.cleared ?? {}, theirs.cleared ?? {}]) {
    for (const [videoId, at] of Object.entries(list)) {
      const seen = merged.cleared[videoId];
      if (!seen || newer(at, seen)) merged.cleared[videoId] = at;
    }
  }
  for (const [videoId, at] of Object.entries(merged.cleared)) {
    const point = merged.positions[videoId];
    if (!point) continue;
    if (newer(point.updatedAt, at)) delete merged.cleared[videoId];
    else delete merged.positions[videoId];
  }

  return merged;
}

function pointKey(point: WatchPoint): string {
  return `${String(point.seconds).padStart(8, "0")}:${point.duration ?? ""}`;
}

/** Strictly later, with an unparseable stamp losing to anything readable. */
function newer(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left)) return false;
  if (!Number.isFinite(right)) return true;
  return left > right;
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

  // The clears and hand-over marks, on the same terms as positions: one older
  // than any stamp it could hold back is no longer holding anything back.
  for (const key of ["cleared", "drained"] as const) {
    for (const [videoId, at] of Object.entries(state[key])) {
      if (Date.parse(at) >= cutoff) continue;
      delete state[key][videoId];
      changed = true;
    }
    const marks = Object.entries(state[key]);
    if (marks.length > MAX_PROGRESS_ENTRIES) {
      marks.sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]));
      for (const [videoId] of marks.slice(0, marks.length - MAX_PROGRESS_ENTRIES)) {
        delete state[key][videoId];
        changed = true;
      }
    }
  }

  // The watch stamps, on the same terms. A year is a long time after the month
  // the tidy measures, so nothing that still matters is ever dropped here.
  const stamps = Object.entries(state.watched).filter(([videoId, at]) => {
    if (Date.parse(at) >= cutoff) return true;
    delete state.watched[videoId];
    changed = true;
    return false;
  });

  if (stamps.length > MAX_PROGRESS_ENTRIES) {
    stamps.sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]));
    for (const [videoId] of stamps.slice(0, stamps.length - MAX_PROGRESS_ENTRIES)) {
      delete state.watched[videoId];
      changed = true;
    }
  }
  return changed;
}
