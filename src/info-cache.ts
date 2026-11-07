/**
 * One answer per video, kept until it expires (GitHub #32, #33).
 *
 * Concurrent asks share one request: "Start in HD" asks for 360p and HD at
 * once, and the auto transcript asks a moment later, and all three wait on
 * the same `yt-dlp -J`. A failure is not kept, so the next ask tries again.
 * In memory only; Part 3 (#34) keeps it across reloads.
 */
export class InfoCache<T> {
  private kept = new Map<string, { value: T; until: number }>();
  private pending = new Map<string, Promise<T>>();
  private readonly now: () => number;
  private readonly maxEntries: number;

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
    this.kept.delete(key);
    this.pending.delete(key);
  }

  clear(): void {
    this.kept.clear();
    this.pending.clear();
  }
}
