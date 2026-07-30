/**
 * The file half of the silence maps — see `silence.ts` for every rule it
 * applies.
 *
 * Same shape as `ProgressStore`: its own file next to `data.json`, written
 * through the vault adapter, saves serialized so one cannot interleave with
 * another. One difference, and it is the important one: **save re-reads the
 * file and merges into it** rather than writing this process's snapshot. The
 * vault is in iCloud and this file is written by a Mac and an iPhone, so a
 * whole-file write would delete whatever the other device had added since load
 * — which is exactly the bug issue 014 spent a day on.
 */

import type { App } from "obsidian";
import {
  emptySilenceState,
  isStale,
  mergeSilenceMaps,
  normalizeSilenceState,
  pruneSilenceMaps,
  pruneWordLists,
} from "./silence.ts";
import type { SilenceMap, SilenceSource, SilenceState, VideoSilence } from "./silence.ts";

/**
 * How long a change waits before it is written.
 *
 * An ffmpeg analysis lands windows in bursts as it streams, so writing on each
 * would be dozens of writes for one video. Batched instead, and flushed outright
 * on teardown.
 */
const WRITE_DEBOUNCE_MS = 3000;

export class SilenceStore {
  private state: SilenceState = emptySilenceState();
  private saving: Promise<void> = Promise.resolve();
  private timer: number | null = null;
  /** Maps recorded since the last write, held for the merge. */
  private queued = new Map<string, SilenceMap>();

  constructor(
    private app: App,
    private path: string,
  ) {}

  async load(): Promise<void> {
    this.state = await this.read();
  }

  private async read(): Promise<SilenceState> {
    try {
      if (await this.app.vault.adapter.exists(this.path)) {
        return normalizeSilenceState(JSON.parse(await this.app.vault.adapter.read(this.path)));
      }
    } catch (err) {
      // A silence map is worth nothing next to the plugin loading, and the
      // worst case is one recompute.
      console.error("YT Free: silence maps unreadable, starting empty.", err);
    }
    return emptySilenceState();
  }

  /**
   * One producer's map for this video, if it can answer at `minGap`.
   *
   * A map built with a coarser floor than the setting now asks for is not
   * returned: it does not contain the shorter pauses, so using it would quietly
   * ignore the setting the user just changed.
   */
  mapFor(videoId: string, source: SilenceSource, minGap: number): SilenceMap | null {
    const map = this.state.maps[videoId]?.sources[source];
    if (!map) return null;
    return isStale(map, minGap) ? null : map;
  }

  /** Whatever is stored for a producer, stale or not — for deciding what to recompute. */
  rawMapFor(videoId: string, source: SilenceSource): SilenceMap | null {
    return this.state.maps[videoId]?.sources[source] ?? null;
  }

  /** Everything stored about a video. */
  entryFor(videoId: string): VideoSilence | null {
    return this.state.maps[videoId] ?? null;
  }

  /** Note a map. A map no better than the one already held costs nothing. */
  record(map: SilenceMap): void {
    if (!mergeSilenceMaps(this.state, [map])) return;
    // Keyed by producer as well as video: since 016 a video has a caption map
    // *and* an ffmpeg map, and keying on the video alone would drop whichever
    // landed first from the pending write.
    this.queued.set(`${map.videoId}:${map.source}`, map);
    this.schedule();
  }

  private schedule(): void {
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
    if (this.queued.size === 0) return this.saving;

    const pending = [...this.queued.values()];
    this.queued.clear();

    this.saving = this.saving
      .then(async () => {
        // Re-read inside the serialized chain, so the merge is against what is
        // on disk at the moment of writing rather than what was there at load.
        const onDisk = await this.read();
        mergeSilenceMaps(onDisk, pending);
        pruneSilenceMaps(onDisk);
        pruneWordLists(onDisk);
        this.state = onDisk;
        await this.app.vault.adapter.write(this.path, JSON.stringify(onDisk));
      })
      .catch((err) => console.error("YT Free: could not write silence maps.", err));
    return this.saving;
  }
}
