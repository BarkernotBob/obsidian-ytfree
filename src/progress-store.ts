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
  private state: ProgressState = emptyProgress();
  private saving: Promise<void> = Promise.resolve();
  private timer: number | null = null;
  private dirty = false;
  /**
   * mtime of the last copy of the file this device successfully read or wrote.
   *
   * The same watermark `SubscriptionsStore` keeps, for the same reason and with
   * the same rule: only a read that answered may advance it, or one blip marks
   * a version seen that never was and this device stays behind for good.
   */
  private diskTime = 0;

  constructor(
    private app: App,
    private path: string,
  ) {}

  async load(): Promise<void> {
    const read = await this.read();
    if (read) this.state = read;
    await this.noteDiskTime();
    if (pruneProgress(this.state, new Date())) this.schedule();
  }

  /**
   * What is in the file this instant, or null if it could not be read.
   *
   * Null covers both "no file yet" and "a file I could not parse", which is a
   * distinction this store does not need: it never overwrites blind — every
   * write merges into whatever it can read first — so the only decision left is
   * whether there is anything to merge.
   */
  private async read(): Promise<ProgressState | null> {
    try {
      if (!(await this.app.vault.adapter.exists(this.path))) return null;
      return normalizeProgress(JSON.parse(await this.app.vault.adapter.read(this.path)));
    } catch (err) {
      // A position is worth nothing next to the plugin loading, so an
      // unreadable file is survivable everywhere this is called from.
      console.error("YT Free: playback positions unreadable.", err);
      return null;
    }
  }

  private async noteDiskTime(): Promise<void> {
    try {
      this.diskTime = (await this.app.vault.adapter.stat(this.path))?.mtime ?? 0;
    } catch {
      // A stat that failed is not evidence of anything. Leave the watermark.
    }
  }

  /**
   * Pick up what the other device has watched since we last looked.
   *
   * This is the whole of "progress crosses both ways". The file was read once
   * at load and never again, so a desktop that had been open since morning was
   * merging every save against its morning snapshot: a position written on the
   * phone at lunch was invisible here, and the next save here wrote over it.
   * The phone appeared to be the only device that synced because it is the one
   * that gets killed and reloaded — every relaunch was a fresh `load`.
   *
   * A stat first, and a read only when the file has actually moved, so this is
   * cheap enough to call whenever a note is opened or the window is focused.
   */
  async refreshFromDisk(): Promise<void> {
    let mtime: number;
    try {
      mtime = (await this.app.vault.adapter.stat(this.path))?.mtime ?? 0;
    } catch {
      return;
    }
    if (mtime === this.diskTime) return;

    const theirs = await this.read();
    // Only a read that answered may say this version has been seen.
    if (!theirs) return;
    this.diskTime = mtime;
    this.state = mergeProgress(this.state, theirs);
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
  flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.saving;
    this.dirty = false;
    // Read, merge, write — never a blind write of this device's snapshot. The
    // file is synced and both devices hold it open, so a plain write means the
    // last device to save wins every video in it, including the ones it has not
    // played since yesterday.
    this.saving = this.saving
      .then(async () => {
        const theirs = await this.read();
        if (theirs) this.state = mergeProgress(this.state, theirs);
        await this.app.vault.adapter.write(this.path, JSON.stringify(this.state));
        await this.noteDiskTime();
      })
      .catch((err) => console.error("YT Free: could not write playback positions.", err));
    return this.saving;
  }
}
