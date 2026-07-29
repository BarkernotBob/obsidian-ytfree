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
  normalizeProgress,
  pruneProgress,
  recordPosition,
  resumePoint,
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

  constructor(
    private app: App,
    private path: string,
  ) {}

  async load(): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(this.path)) {
        this.state = normalizeProgress(JSON.parse(await this.app.vault.adapter.read(this.path)));
      }
    } catch (err) {
      // A position is worth nothing next to the plugin loading, so an
      // unreadable file starts empty rather than stopping anything.
      console.error("YT Free: playback positions unreadable, starting empty.", err);
      this.state = emptyProgress();
    }
    if (pruneProgress(this.state, new Date())) this.schedule();
  }

  /** Where to pick this video up, or 0. */
  resumeFor(videoId: string): number {
    return resumePoint(this.state, videoId);
  }

  /** Note a position. Only a real change costs a write. */
  record(videoId: string, seconds: number, duration: number): void {
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
    this.saving = this.saving
      .then(() => this.app.vault.adapter.write(this.path, JSON.stringify(this.state)))
      .catch((err) => console.error("YT Free: could not write playback positions.", err));
    return this.saving;
  }
}
