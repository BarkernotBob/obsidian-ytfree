/**
 * Watch history and its stats (GitHub #48) — the rules, without Obsidian.
 *
 * `history.json` sits next to `progress.json` and syncs the same way, through
 * the vault. It is the one record that is never pruned: every video you have
 * watched stays until you remove it yourself. See
 * `docs/V1-SCOPE-WATCH-HISTORY.md`.
 *
 * Three things make it safe to merge two devices' copies:
 *
 *   - **Watch time is per device.** A device only ever adds to its own counter,
 *     and a merge keeps the larger of two copies of the same counter. The total
 *     is the sum over devices, so Mac + phone never double count, and an old
 *     copy of the file can never roll a number back.
 *   - **Removals are tombstones.** Removing a video stamps when; a copy whose
 *     last watch is not newer than that stamp is dropped on merge, so the other
 *     device cannot merge it back in. Watching it again afterwards starts a
 *     fresh entry, which a tombstone does not touch.
 *   - **Clear history is one tombstone for everything** (`clearedAt`).
 *
 * Pure and platform-neutral like `progress.ts`, so `node --test` covers it.
 */

import { inProgressFloor, isFinished } from "./progress.ts";

export interface HistoryEntry {
  /** As the player knew it when last watched. "" when nothing knew it. */
  title: string;
  channel: string;
  channelId?: string;
  /** Seconds, as the player measured it. */
  duration?: number;
  /** ISO. When it first entered history. */
  firstAt: string;
  /** ISO. The last time any player — note or Preview — played it. */
  lastAt: string;
  /**
   * ISO. The last time a *note* player played it, which is what the note tidy
   * asks (`tidy.ts`). Kept apart from `lastAt` because Preview must not make a
   * note eligible for the trash: previewing is not watching the note.
   */
  playedAt?: string;
  /** Seconds actually spent playing, by device. Summed for the stats. */
  watch: Record<string, number>;
}

export interface HistoryState {
  entries: Record<string, HistoryEntry>;
  /** videoId → ISO time it was removed from history. Never pruned; tiny. */
  removed: Record<string, string>;
  /** ISO time of the last Clear history, or absent. */
  clearedAt?: string;
}

/** What the player knows about a video when it reports. */
export interface HistoryMeta {
  title?: string;
  channel?: string;
  channelId?: string;
}

export function emptyHistory(): HistoryState {
  return { entries: {}, removed: {} };
}

const VIDEO_ID = /^[\w-]{11}$/;

function time(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string | null {
  const parsed = time(str(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Whatever was on disk, made safe to use. Unknown fields and bad rows are dropped. */
export function normalizeHistory(raw: unknown): HistoryState {
  const state = emptyHistory();
  const input = (raw ?? {}) as Partial<Record<keyof HistoryState, unknown>>;

  const entries = input.entries;
  if (entries && typeof entries === "object") {
    for (const [videoId, value] of Object.entries(entries as Record<string, unknown>)) {
      if (!VIDEO_ID.test(videoId) || !value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const lastAt = iso(row.lastAt);
      if (!lastAt) continue;
      const firstAt = iso(row.firstAt) ?? lastAt;
      const watch: Record<string, number> = {};
      if (row.watch && typeof row.watch === "object") {
        for (const [device, seconds] of Object.entries(row.watch as Record<string, unknown>)) {
          const n = Math.floor(Number(seconds));
          if (device && Number.isFinite(n) && n > 0) watch[device] = n;
        }
      }
      const entry: HistoryEntry = {
        title: str(row.title),
        channel: str(row.channel),
        firstAt,
        lastAt,
        watch,
      };
      const channelId = str(row.channelId);
      if (channelId) entry.channelId = channelId;
      const duration = Number(row.duration);
      if (Number.isFinite(duration) && duration > 0) entry.duration = Math.round(duration);
      const playedAt = iso(row.playedAt);
      if (playedAt) entry.playedAt = playedAt;
      state.entries[videoId] = entry;
    }
  }

  const removed = input.removed;
  if (removed && typeof removed === "object") {
    for (const [videoId, at] of Object.entries(removed as Record<string, unknown>)) {
      const stamp = iso(at);
      if (VIDEO_ID.test(videoId) && stamp) state.removed[videoId] = stamp;
    }
  }

  const clearedAt = iso(input.clearedAt);
  if (clearedAt) state.clearedAt = clearedAt;
  return dropBuried(state);
}

/** Is this entry older than a removal or a clear that covers it? */
function buried(state: HistoryState, videoId: string, entry: HistoryEntry): boolean {
  const last = time(entry.lastAt);
  if (state.clearedAt && last <= time(state.clearedAt)) return true;
  const removedAt = state.removed[videoId];
  return Boolean(removedAt && last <= time(removedAt));
}

function dropBuried(state: HistoryState): HistoryState {
  for (const [videoId, entry] of Object.entries(state.entries)) {
    if (buried(state, videoId, entry)) delete state.entries[videoId];
  }
  return state;
}

function later(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return time(a) >= time(b) ? a : b;
}

/**
 * Which copy's words win. The later watch; on a tie, decided on content, never
 * on which device is merging, or two devices with the same stamp and different
 * titles would rewrite the file back and forth (`SyncCodec.merge`).
 */
function newerOf(a: HistoryEntry, b: HistoryEntry): HistoryEntry {
  const ta = time(a.lastAt);
  const tb = time(b.lastAt);
  if (ta !== tb) return tb > ta ? b : a;
  const key = (e: HistoryEntry) => JSON.stringify([e.title, e.channel, e.channelId ?? "", e.duration ?? 0]);
  return key(b) > key(a) ? b : a;
}

function mergeEntry(a: HistoryEntry, b: HistoryEntry): HistoryEntry {
  const newer = newerOf(a, b);
  const older = newer === a ? b : a;
  const watch: Record<string, number> = { ...a.watch };
  for (const [device, seconds] of Object.entries(b.watch)) {
    watch[device] = Math.max(watch[device] ?? 0, seconds);
  }
  const merged: HistoryEntry = {
    // The newer copy's words, unless it had none: a play from a screen that
    // did not know the title must not erase one the other device had.
    title: newer.title || older.title,
    channel: newer.channel || older.channel,
    firstAt: time(a.firstAt) <= time(b.firstAt) ? a.firstAt : b.firstAt,
    lastAt: newer.lastAt,
    watch,
  };
  const channelId = newer.channelId || older.channelId;
  if (channelId) merged.channelId = channelId;
  const duration = newer.duration ?? older.duration;
  if (duration) merged.duration = duration;
  const playedAt = later(a.playedAt, b.playedAt);
  if (playedAt) merged.playedAt = playedAt;
  return merged;
}

/** Fold another device's copy into this one. Neither input is changed. */
export function mergeHistory(mine: HistoryState, theirs: HistoryState): HistoryState {
  const merged = emptyHistory();
  const clearedAt = later(mine.clearedAt, theirs.clearedAt);
  if (clearedAt) merged.clearedAt = clearedAt;

  for (const source of [mine.removed, theirs.removed]) {
    for (const [videoId, at] of Object.entries(source)) {
      merged.removed[videoId] = later(merged.removed[videoId], at) ?? at;
    }
  }

  for (const source of [mine.entries, theirs.entries]) {
    for (const [videoId, entry] of Object.entries(source)) {
      // A copy from before a removal or a clear never feeds a newer entry: its
      // watch time belongs to the history that was deleted.
      if (buried(merged, videoId, entry)) continue;
      const ours = merged.entries[videoId];
      merged.entries[videoId] = ours ? mergeEntry(ours, entry) : { ...entry, watch: { ...entry.watch } };
    }
  }
  return dropBuried(merged);
}

/**
 * Has this report got far enough in for the video to count as watched?
 *
 * The In progress floor, `min(2 min, 10%)` (Isaiah, 2026-11-09), or the
 * credits. A video of unknown length cannot pass: there is no 10% to take.
 */
export function passesFloor(seconds: number, duration: number): boolean {
  const floor = inProgressFloor(duration);
  if (floor === null) return false;
  return seconds >= floor || isFinished(seconds, duration);
}

/**
 * Note a progress report. Answers whether anything changed.
 *
 * A video that is not in history yet only enters once `passesFloor`; one
 * already there just has its last-watched time and words brought up to date.
 * `note` is true for a note player, false for Preview — see `playedAt`.
 */
export function recordPlay(
  state: HistoryState,
  videoId: string,
  seconds: number,
  duration: number,
  meta: HistoryMeta,
  now: Date,
  note: boolean,
): boolean {
  if (!VIDEO_ID.test(videoId)) return false;
  const at = now.toISOString();
  let entry = state.entries[videoId];
  if (!entry) {
    if (!passesFloor(seconds, duration)) return false;
    entry = { title: "", channel: "", firstAt: at, lastAt: at, watch: {} };
    state.entries[videoId] = entry;
  }
  entry.lastAt = at;
  if (note) entry.playedAt = at;
  if (meta.title) entry.title = meta.title;
  if (meta.channel) entry.channel = meta.channel;
  if (meta.channelId) entry.channelId = meta.channelId;
  if (Number.isFinite(duration) && duration > 0) entry.duration = Math.round(duration);
  return true;
}

/** Add seconds of real playing time to this device's counter. Only for a video in history. */
export function addWatchTime(
  state: HistoryState,
  videoId: string,
  device: string,
  seconds: number,
): boolean {
  const entry = state.entries[videoId];
  if (!entry || !(seconds > 0)) return false;
  entry.watch[device] = (entry.watch[device] ?? 0) + seconds;
  return true;
}

/** Take one video out of history, on every device. */
export function removeFromHistory(state: HistoryState, videoId: string, now: Date): boolean {
  const had = videoId in state.entries;
  delete state.entries[videoId];
  state.removed[videoId] = now.toISOString();
  return had;
}

/** Everything, on every device. Removal stamps are no longer needed after it. */
export function clearHistory(state: HistoryState, now: Date): void {
  state.entries = {};
  state.removed = {};
  state.clearedAt = now.toISOString();
}

/**
 * Bring in the old watch stamps from `progress.json` (one time, idempotent).
 *
 * They have no title and no watch time; the title is looked up when the list
 * is drawn. A stamp is also what the note tidy used to read, so it becomes
 * `playedAt` as well — the tidy keeps working on the notes it knew about.
 */
export function importStamps(state: HistoryState, stamps: Record<string, string>): boolean {
  let changed = false;
  for (const [videoId, at] of Object.entries(stamps)) {
    const stamp = iso(at);
    if (!stamp || !VIDEO_ID.test(videoId)) continue;
    const incoming: HistoryEntry = {
      title: "",
      channel: "",
      firstAt: stamp,
      lastAt: stamp,
      playedAt: stamp,
      watch: {},
    };
    if (buried(state, videoId, incoming)) continue;
    const ours = state.entries[videoId];
    const next = ours ? mergeEntry(ours, incoming) : incoming;
    if (!ours || !sameEntry(next, ours)) {
      state.entries[videoId] = next;
      changed = true;
    }
  }
  return changed;
}

/**
 * Real playing time in one span of the player's clock, in ms.
 *
 * The smaller of the wall clock and the media time covered at this speed:
 * a suspended phone moves the clock and not the video, and 2× moves the video
 * twice as fast as the clock. 100 ms of slack absorbs rate rounding. A span
 * where the media went backwards or nowhere counts nothing.
 */
export function playedSpanMs(wallMs: number, mediaSeconds: number, rate: number): number {
  const speed = rate > 0 && Number.isFinite(rate) ? rate : 1;
  const media = (mediaSeconds / speed) * 1000;
  if (!(wallMs > 0) || !(media > 0)) return 0;
  return Math.min(wallMs, media + 100);
}

function sameEntry(a: HistoryEntry, b: HistoryEntry): boolean {
  return (
    a.title === b.title &&
    a.channel === b.channel &&
    a.channelId === b.channelId &&
    a.duration === b.duration &&
    a.firstAt === b.firstAt &&
    a.lastAt === b.lastAt &&
    a.playedAt === b.playedAt &&
    JSON.stringify(Object.entries(a.watch).sort()) === JSON.stringify(Object.entries(b.watch).sort())
  );
}

/** Total seconds over every device. */
export function watchSeconds(entry: HistoryEntry): number {
  let total = 0;
  for (const seconds of Object.values(entry.watch)) total += seconds;
  return total;
}

export interface HistoryStats {
  videos: number;
  seconds: number;
}

export function historyStats(state: HistoryState): HistoryStats {
  let seconds = 0;
  const entries = Object.values(state.entries);
  for (const entry of entries) seconds += watchSeconds(entry);
  return { videos: entries.length, seconds };
}

/** "38h 12m watched", "12m watched", "0m watched". */
export function formatWatchTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

/** The line at the top of History: `142 videos · 38h 12m watched`. */
export function statsLine(stats: HistoryStats): string {
  const noun = stats.videos === 1 ? "video" : "videos";
  return `${stats.videos} ${noun} · ${formatWatchTime(stats.seconds)} watched`;
}

/** Lower case, accents off, so "beyonce" finds "Beyoncé". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Does a history row match the search box? Title and channel only; every
 * word has to appear somewhere, in any order — the hub box's rule, with
 * accents ignored.
 */
export function historyMatches(title: string, channel: string, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(`${title} ${channel}`);
  return terms.every((term) => haystack.includes(term));
}

/** videoId → lastAt, newest first. What the hub's History list is built from. */
export function historyOrder(state: HistoryState): Map<string, string> {
  const rows = Object.entries(state.entries).sort((a, b) => time(b[1].lastAt) - time(a[1].lastAt));
  return new Map(rows.map(([videoId, entry]) => [videoId, entry.lastAt]));
}
