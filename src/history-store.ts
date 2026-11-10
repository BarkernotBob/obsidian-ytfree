/**
 * The file half of watch history (GitHub #48) — see `history.ts` for the rules.
 *
 * The file is a `SyncedFile` (`synced-file.ts`, GitHub #77), like the hub and
 * progress files: every save reads and merges first, a file that cannot be
 * read is never written over, a read that shows the file missing something
 * this device knows writes it back, conflict copies are merged in, and a
 * device-local copy survives the app being killed before a write landed.
 *
 * Writes are batched: a video entering history is a few seconds from disk,
 * watch time at most a minute, and `flush` runs on teardown and when the app is
 * backgrounded.
 */

import type { App } from "obsidian";
import {
  addWatchTime,
  clearHistory,
  emptyHistory,
  historyOrder,
  historyStats,
  importStamps,
  mergeHistory,
  normalizeHistory,
  recordPlay,
  removeFromHistory,
} from "./history.ts";
import type { HistoryEntry, HistoryMeta, HistoryState, HistoryStats } from "./history.ts";
import { SyncedFile, adapterDisk, canonical } from "./synced-file.ts";
import type { LocalCopy, SyncDisk } from "./synced-file.ts";

/** At most one write a minute while something plays. */
const WRITE_DELAY_MS = 60_000;
/** A video entering history, or old stamps arriving, goes out sooner. */
const SOON_MS = 4000;

/** This device's name in the per-device watch counters. Device-local, never synced. */
const DEVICE_KEY = "ytfree-device-id";

/**
 * The largest history kept in the device-local copy. History is never pruned,
 * and local storage is a few MB shared with everything else the plugin keeps
 * there (the bot-check pause among them), so past this the local copy is
 * dropped rather than allowed to crowd those out. The synced file is still the
 * record; only the kill-before-write safety net is lost, for very large
 * histories.
 */
export const LOCAL_COPY_MAX_CHARS = 1_000_000;

export function cappedLocalCopy(inner: LocalCopy, max = LOCAL_COPY_MAX_CHARS): LocalCopy {
  return {
    read: () => inner.read(),
    write: (value) => inner.write(value.length <= max ? value : ""),
  };
}

export function deviceId(): string {
  try {
    const kept = window.localStorage.getItem(DEVICE_KEY);
    if (kept) return kept;
    const made = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    window.localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    // No storage: one id for this session. Its counter still merges correctly;
    // it just starts a new column after a restart.
    return `s${Date.now().toString(36)}`;
  }
}

export class HistoryStore {
  private file: SyncedFile<HistoryState>;
  private timer: number | null = null;
  private dirty = false;
  /**
   * Seconds played of videos not in history yet. A video counts from its first
   * second once it passes the floor, so the time before that is held here and
   * folded in when it does. Memory only: a video abandoned under the floor was
   * never watched, and its seconds go with it.
   */
  private pending = new Map<string, number>();
  private listeners = new Set<() => void>();
  readonly device: string;

  constructor(
    app: App | null,
    path: string,
    local: LocalCopy | null = null,
    device: string = deviceId(),
    disk: SyncDisk | null = null,
  ) {
    this.device = device;
    const io = disk ?? (app ? adapterDisk(app.vault.adapter) : null);
    if (!io) throw new Error("HistoryStore needs a vault or a disk");
    this.file = new SyncedFile(
      io,
      path,
      { empty: emptyHistory, parse: normalizeHistory, merge: mergeHistory },
      local ? cappedLocalCopy(local) : null,
    );
  }

  private get state(): HistoryState {
    return this.file.state;
  }

  async load(): Promise<void> {
    if (await this.file.load()) this.schedule(true);
  }

  /** Called when the visible history changes, from here or from the other device. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** Pick up what the other device wrote, and send back what it is missing. */
  async refreshFromDisk(): Promise<void> {
    if (await this.file.refresh()) this.changed();
  }

  // ------------------------------------------------------------- reading

  entries(): Readonly<Record<string, HistoryEntry>> {
    return this.state.entries;
  }

  /** videoId → last watched, newest first. */
  order(): Map<string, string> {
    return historyOrder(this.state);
  }

  stats(): HistoryStats {
    return historyStats(this.state);
  }

  /** When a note player last played this video, or null. Read by the note tidy. */
  playedAt(videoId: string): string | null {
    return this.state.entries[videoId]?.playedAt ?? null;
  }

  // ------------------------------------------------------------- writing

  /** A progress report from a player. `note` is false for Preview. */
  record(videoId: string, seconds: number, duration: number, meta: HistoryMeta, note: boolean): void {
    const isNew = !(videoId in this.state.entries);
    if (!recordPlay(this.state, videoId, seconds, duration, meta, new Date(), note)) return;
    if (isNew) {
      const held = this.pending.get(videoId) ?? 0;
      this.pending.delete(videoId);
      addWatchTime(this.state, videoId, this.device, held);
      this.changed();
      this.schedule(true);
      return;
    }
    this.schedule();
  }

  /** Seconds of real playing time, from the player. */
  addWatch(videoId: string, seconds: number): void {
    if (!(seconds > 0)) return;
    if (addWatchTime(this.state, videoId, this.device, seconds)) {
      this.schedule();
      return;
    }
    this.pending.set(videoId, (this.pending.get(videoId) ?? 0) + seconds);
  }

  /**
   * The old watch stamps from `progress.json`, handed over by `ProgressStore`.
   * Answers true only once the file holds them, which is when the progress
   * file may drop them.
   */
  async importStamps(stamps: Record<string, string>): Promise<boolean> {
    if (importStamps(this.state, stamps)) this.changed();
    this.cancelTimer();
    this.dirty = false;
    const outcome = await this.file.save();
    if (!outcome.landed) this.schedule();
    return outcome.landed;
  }

  async remove(videoId: string): Promise<void> {
    removeFromHistory(this.state, videoId, new Date());
    this.pending.delete(videoId);
    this.changed();
    this.dirty = true;
    await this.flush();
  }

  async clear(): Promise<void> {
    clearHistory(this.state, new Date());
    this.pending.clear();
    this.changed();
    this.dirty = true;
    await this.flush();
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(soon = false): void {
    this.dirty = true;
    if (soon) this.cancelTimer();
    if (this.timer !== null) return;
    this.timer = window.setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      soon ? SOON_MS : WRITE_DELAY_MS,
    );
  }

  /** Write now, if there is anything to write. A refused write stays owed. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (!this.dirty) {
      await this.file.settle();
      return;
    }
    this.dirty = false;
    const before = canonical(historyStats(this.state)) + Object.keys(this.state.entries).length;
    const outcome = await this.file.save();
    if (!outcome.landed) this.schedule();
    // The save merged in the file: the other device's watches may be new here.
    const after = canonical(historyStats(this.state)) + Object.keys(this.state.entries).length;
    if (after !== before) this.changed();
  }
}
