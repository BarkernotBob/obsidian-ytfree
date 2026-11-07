/**
 * One answer per video, kept until it expires (GitHub #32, #33).
 *
 * Concurrent asks share one request: "Start in HD" asks for 360p and HD at
 * once, and the auto transcript asks a moment later, and all three wait on
 * the same `yt-dlp -J`. A failure is not kept, so the next ask tries again.
 * `attachStore` keeps it across reloads too (GitHub #34), on the device only:
 * the links inside are tied to the network that asked, so they must never
 * reach the synced vault.
 */

/** Device-local storage for kept answers. `localStorage` in the app. */
export interface AnswerStore {
  read(): string | null;
  write(value: string): void;
}
export class InfoCache<T> {
  private kept = new Map<string, { value: T; until: number }>();
  private pending = new Map<string, Promise<T>>();
  private readonly now: () => number;
  private readonly maxEntries: number;
  private store: AnswerStore | null = null;
  private trim: (value: T) => T = (v) => v;

  /** `maxEntries` bounds memory: the oldest answer goes first. */
  constructor(now: () => number = () => Date.now(), maxEntries = 50) {
    this.now = now;
    this.maxEntries = maxEntries;
  }

  /** The kept answer for `key`, or the one `load` gives, kept until `until(value)`. */
  get(key: string, load: () => Promise<T>, until: (value: T) => number): Promise<T> {
    const hit = this.kept.get(key);
    if (hit && hit.until > this.now()) return Promise.resolve(hit.value);
    if (hit) this.kept.delete(key);

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const request = load().then(
      (value) => {
        if (this.pending.get(key) === request) {
          this.pending.delete(key);
          const keepUntil = until(value);
          if (keepUntil > this.now()) {
            this.kept.delete(key);
            this.kept.set(key, { value, until: keepUntil });
            // Map order is insertion order: the first key is the oldest.
            while (this.kept.size > this.maxEntries) this.kept.delete(this.kept.keys().next().value!);
            this.save();
          }
        }
        return value;
      },
      (err: unknown) => {
        if (this.pending.get(key) === request) this.pending.delete(key);
        throw err;
      },
    );
    this.pending.set(key, request);
    return request;
  }

  /** Forget `key`, so the next ask goes out fresh (a stream that died). */
  invalidate(key: string): void {
    const had = this.kept.delete(key);
    this.pending.delete(key);
    if (had) this.save();
  }

  clear(): void {
    this.kept.clear();
    this.pending.clear();
    this.save();
  }

  /**
   * Load what an earlier session kept, and keep what this one learns.
   * `trim` drops what the plugin never reads, so the stored copy stays small.
   */
  attachStore(store: AnswerStore, trim: (value: T) => T = (v) => v): void {
    this.store = store;
    this.trim = trim;
    let entries: Array<[string, { value: T; until: number }]> = [];
    try {
      const parsed = JSON.parse(store.read() ?? "[]") as unknown;
      if (Array.isArray(parsed)) entries = parsed as typeof entries;
    } catch {
      // Unreadable: start empty.
    }
    const now = this.now();
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const kept = entry[1];
      if (!kept || typeof kept.until !== "number" || kept.until <= now) continue;
      if (!this.kept.has(entry[0])) this.kept.set(entry[0], kept);
    }
    while (this.kept.size > this.maxEntries) this.kept.delete(this.kept.keys().next().value!);
  }

  private save(): void {
    if (!this.store) return;
    const now = this.now();
    const entries = [...this.kept]
      .filter(([, kept]) => kept.until > now)
      .map(([key, kept]) => [key, { value: this.trim(kept.value), until: kept.until }]);
    try {
      this.store.write(JSON.stringify(entries));
    } catch {
      // Storage full or gone: the answers still hold in memory.
    }
  }
}
