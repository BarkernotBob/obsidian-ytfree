/**
 * The file half of "where you got to" — see `progress.ts` for the rules.
 *
 * Same shape as `SubscriptionsStore`: its own file next to `data.json`, written
 * through the vault adapter, serialized so a save landing inside another save
 * cannot interleave. Every decision it makes is imported; this is only the I/O.
 */

import type { App } from "obsidian";
import {
  emptyProgress,
  inProgressVideos,
  mergeProgress,
  normalizeProgress,
  pruneProgress,
  recordPosition,
  resumePoint,
} from "./progress.ts";
import type { ProgressState } from "./progress.ts";
import { SyncedFile, adapterDisk } from "./synced-file.ts";
import type { LocalCopy } from "./synced-file.ts";

/**
 * How long a change waits before it is written.
 *
 * Playback reports every five seconds and each report moves one number, so
 * writing on each would be a file write every five seconds for as long as
 * anything is playing. Batched instead — and flushed outright on teardown, so
 * the delay can never be the reason a position is lost.
 */
const WRITE_DEBOUNCE_MS = 4000;

export class ProgressStore {
  private timer: number | null = null;
  private dirty = false;
  /** The file and its sync rules — see `synced-file.ts` (V1-SCOPE-SYNC). */
  private file: SyncedFile<ProgressState>;
  /**
   * Where the old "watched" stamps go (GitHub #48). They moved to
   * `history.json`; any still in this file — written before the move, or by a
   * device still on an older build — are handed over and dropped from here.
   */
  private stampSink: ((stamps: Record<string, string>) => Promise<boolean>) | null = null;
  private draining = false;

  constructor(
    app: App,
    private path: string,
    local: LocalCopy | null = null,
  ) {
    this.file = new SyncedFile(
      adapterDisk(app.vault.adapter),
      path,
      { empty: emptyProgress, parse: normalizeProgress, merge: mergeProgress },
      local,
    );
  }

  private get state(): ProgressState {
    return this.file.state;
  }

  async load(): Promise<void> {
    const owed = await this.file.load();
    if (pruneProgress(this.state, new Date()) || owed) this.schedule();
  }

  /**
   * Hand every watch stamp, now and on every later read, to history.
   *
   * A stamp leaves this file only after the sink says history is on disk with
   * it, so a crash or an unreadable `history.json` mid-move loses nothing: the
   * stamp is still here next time, and importing it twice changes nothing.
   */
  drainStampsTo(sink: (stamps: Record<string, string>) => Promise<boolean>): void {
    this.stampSink = sink;
    void this.drainStamps();
  }

  private async drainStamps(): Promise<void> {
    if (!this.stampSink || this.draining) return;
    const stamps = { ...this.state.watched };
    if (Object.keys(stamps).length === 0) return;
    this.draining = true;
    try {
      if (!(await this.stampSink(stamps))) return;
      for (const [videoId, at] of Object.entries(stamps)) {
        if (this.state.watched[videoId] === at) delete this.state.watched[videoId];
      }
      this.schedule();
    } finally {
      this.draining = false;
    }
  }

  /**
   * Pick up what the other device has watched since we last looked, and send
   * back what it is missing.
   *
   * A stat first, and a read only when the file has actually moved, so this is
   * cheap enough to call whenever a note is opened or the window is focused.
   */
  async refreshFromDisk(): Promise<void> {
    await this.file.refresh();
    void this.drainStamps();
  }

  /** Where to pick this video up, or 0. */
  /**
   * Which videos are part-way through. The rules are `inProgressVideos`; this
   * is only the handle on the state, which stays private so nothing outside can
   * write a position without going through `recordPosition`.
   */
  inProgress(durationFor: (videoId: string) => number | null | undefined): ReadonlyMap<string, string> {
    return inProgressVideos(this.state, durationFor);
  }

  resumeFor(videoId: string): number {
    return resumePoint(this.state, videoId);
  }

  /**
   * Note a position. Only a real change costs a write.
   *
   * The "you watched this" stamp that used to ride along here lives in
   * `history.json` now (GitHub #48; `HistoryStore.record`).
   */
  recordPosition(videoId: string, seconds: number, duration: number): void {
    if (recordPosition(this.state, videoId, seconds, duration, new Date())) this.schedule();
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Write now, if there is anything to write. Awaited by `onunload`. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) {
      await this.file.settle();
      return;
    }
    this.dirty = false;
    // Read, merge, write — and never over a file that could not be read. A
    // refused write stays dirty and is tried again.
    const outcome = await this.file.save();
    if (!outcome.landed) this.schedule();
    // Stamps another device wrote since the last read go to history.
    if (outcome.landed && Object.keys(this.state.watched).length > 0) void this.drainStamps();
  }
}
