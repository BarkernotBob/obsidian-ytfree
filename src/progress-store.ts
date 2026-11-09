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
  markWatched,
  mergeProgress,
  normalizeProgress,
  pruneProgress,
  recordPosition,
  resumePoint,
  watchedAt,
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
   * Pick up what the other device has watched since we last looked, and send
   * back what it is missing.
   *
   * A stat first, and a read only when the file has actually moved, so this is
   * cheap enough to call whenever a note is opened or the window is focused.
   */
  async refreshFromDisk(): Promise<void> {
    await this.file.refresh();
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

  /** When this video was last played, or null. Read by the note tidy. */
  watchedFor(videoId: string): string | null {
    return watchedAt(this.state, videoId);
  }

  /** Note a position. Only a real change costs a write. */
  record(videoId: string, seconds: number, duration: number): void {
    const now = new Date();
    // Both, always, and neither short-circuits the other: a position at the
    // credits is deleted rather than stored, and that is exactly the report
    // that most needs to leave a watch stamp behind.
    const moved = recordPosition(this.state, videoId, seconds, duration, now);
    const stamped = markWatched(this.state, videoId, now);
    if (moved || stamped) this.schedule();
  }

  /**
   * Note a position without saying the video was watched.
   *
   * What Preview reports. The two halves of `record` are separable for exactly
   * this reason: a preview and a later watch are the same session in different
   * containers, so the position has to carry over — but a preview that stamped
   * `watched` would punish previewing, and a hub that punishes previewing is a
   * hub where you press Watch on everything, which is the thing the preview
   * exists to stop.
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
  }
}
