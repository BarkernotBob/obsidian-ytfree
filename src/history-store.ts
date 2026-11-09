/**
 * The file half of watch history (GitHub #48) — see `history.ts` for the rules.
 *
 * Same protocol as `ProgressStore`, with one rule made stricter because this
 * file is never pruned and holds years: a save always reads and merges first,
 * and a file that exists but cannot be read (an iCloud placeholder, a copy
 * caught mid-sync) means **no write**. Writing then would replace the whole
 * history with this device's copy. The change stays in memory and goes out
 * with the next save that can read the file.
 *
 * Writes are batched: a video entering history or a pause is at most a minute
 * from disk, and `flush` runs on teardown and when the app is backgrounded.
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

/** At most one write a minute while something plays. */
const WRITE_DELAY_MS = 60_000;

/** This device's name in the per-device watch counters. Device-local, never synced. */
const DEVICE_KEY = "ytfree-device-id";

type DiskRead = { kind: "state"; state: HistoryState } | { kind: "absent" } | { kind: "unreadable" };

/** Entries, removals, total watch time, newest watch and the clear stamp. */
function signatureOf(state: HistoryState): string {
  const stats = historyStats(state);
  let latest = 0;
  for (const entry of Object.values(state.entries)) latest = Math.max(latest, Date.parse(entry.lastAt) || 0);
  return `${stats.videos}:${Object.keys(state.removed).length}:${stats.seconds}:${latest}:${state.clearedAt ?? ""}`;
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
  private state: HistoryState = emptyHistory();
  private saving: Promise<void> = Promise.resolve();
  private timer: number | null = null;
  private dirty = false;
  private lastWriteOk = true;
  private diskTime = 0;
  /**
   * Seconds played of videos not in history yet. A video counts from its first
   * second once it passes the floor, so the time before that is held here and
   * folded in when it does. Memory only: a video abandoned under the floor was
   * never watched, and its seconds go with it.
   */
  private pending = new Map<string, number>();
  private listeners = new Set<() => void>();
  readonly device: string;
  private readonly app: App;
  private readonly path: string;

  constructor(app: App, path: string, device: string = deviceId()) {
    this.app = app;
    this.path = path;
    this.device = device;
  }

  async load(): Promise<void> {
    const read = await this.read();
    if (read.kind === "state") this.state = read.state;
    await this.noteDiskTime();
  }

  /** Called when the visible history changes, from here or from the other device. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Cheap fingerprint of what History shows, so a no-op merge redraws nothing. */
  private signature(): string {
    return signatureOf(this.state);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private async read(): Promise<DiskRead> {
    try {
      if (!(await this.app.vault.adapter.exists(this.path))) return { kind: "absent" };
      return { kind: "state", state: normalizeHistory(JSON.parse(await this.app.vault.adapter.read(this.path))) };
    } catch (err) {
      console.error("YT Free: watch history unreadable; not writing until it can be read.", err);
      return { kind: "unreadable" };
    }
  }

  private async noteDiskTime(): Promise<void> {
    try {
      this.diskTime = (await this.app.vault.adapter.stat(this.path))?.mtime ?? 0;
    } catch {
      // Leave the watermark.
    }
  }

  /** Pick up what the other device wrote. A stat, and a read only if the file moved. */
  async refreshFromDisk(): Promise<void> {
    let mtime: number;
    try {
      mtime = (await this.app.vault.adapter.stat(this.path))?.mtime ?? 0;
    } catch {
      return;
    }
    if (mtime === this.diskTime) return;
    const theirs = await this.read();
    if (theirs.kind !== "state") return;
    this.diskTime = mtime;
    const before = this.signature();
    this.state = mergeHistory(this.state, theirs.state);
    if (this.signature() !== before) this.changed();
    // Write back when the file is missing something this device knows. iCloud
    // keeps one whole copy when both devices write before seeing each other,
    // so a removal or a watch made here can vanish from the file; merging it
    // back into memory is not enough, it has to go back to disk.
    if (this.signature() !== signatureOf(theirs.state)) this.schedule(true);
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
      // Entering history is worth a prompt write.
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
   * Answers true only once history is on disk with them, which is when the
   * progress file may drop them.
   */
  async importStamps(stamps: Record<string, string>): Promise<boolean> {
    if (importStamps(this.state, stamps)) {
      this.changed();
      this.dirty = true;
    }
    await this.flush();
    return !this.dirty && this.lastWriteOk;
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

  private schedule(soon = false): void {
    this.dirty = true;
    if (soon && this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.timer !== null) return;
    this.timer = window.setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      soon ? 4000 : WRITE_DELAY_MS,
    );
  }

  /** Write now, if there is anything to write. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.saving;
    this.dirty = false;
    this.saving = this.saving
      .then(async () => {
        const theirs = await this.read();
        if (theirs.kind === "unreadable") {
          // Keep the change and try again later; never write over a file we
          // could not read.
          this.lastWriteOk = false;
          this.schedule();
          return;
        }
        if (theirs.kind === "state") {
          const before = this.signature();
          this.state = mergeHistory(this.state, theirs.state);
          if (this.signature() !== before) this.changed();
        }
        await this.app.vault.adapter.write(this.path, JSON.stringify(this.state));
        this.lastWriteOk = true;
        await this.noteDiskTime();
      })
      .catch((err) => {
        this.dirty = true;
        this.lastWriteOk = false;
        console.error("YT Free: could not write watch history.", err);
      });
    return this.saving;
  }
}
