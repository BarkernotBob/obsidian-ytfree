/**
 * An hls.js loader for the in-memory playlists `adaptive.ts` builds.
 *
 * Playlist URLs are answered from memory. Every other request is a byte range
 * of a googlevideo file, fetched through the injected `fetchRange` — which is
 * `requestUrl` in the app, because googlevideo sends no CORS headers and the
 * renderer's own `fetch` would be refused.
 *
 * Type-only imports from hls.js: the player already bundles it, and this file
 * has to load under `node --test` without it.
 */

import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";
import type { VirtualPlaylist } from "./stream.ts";

function newStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export type LoaderClass = new (config: HlsConfig) => Loader<LoaderContext>;

export function virtualLoader(source: VirtualPlaylist): LoaderClass {
  return class VirtualLoader implements Loader<LoaderContext> {
    context: LoaderContext | null = null;
    stats: LoaderStats = newStats();
    private done = false;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(_config: HlsConfig) {
      // Nothing to configure: the source is closed over.
    }

    destroy(): void {
      this.abort();
      this.context = null;
    }

    abort(): void {
      if (this.done) return;
      this.done = true;
      this.stats.aborted = true;
      this.clearTimer();
    }

    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
      this.context = context;
      this.done = false;
      this.stats = newStats();
      this.stats.loading.start = now();

      const limit = config.loadPolicy?.maxLoadTimeMs || config.timeout;
      if (limit > 0) {
        this.timer = setTimeout(() => {
          if (this.done) return;
          this.done = true;
          callbacks.onTimeout(this.stats, context, null);
        }, limit);
      }

      const text = source.files[context.url];
      const work: Promise<string | ArrayBuffer> =
        text !== undefined ? Promise.resolve(text) : this.fetchBytes(context);

      work.then(
        (data) => {
          if (this.done) return;
          this.done = true;
          this.clearTimer();
          const size = typeof data === "string" ? data.length : data.byteLength;
          const t = now();
          this.stats.loading.first = t;
          this.stats.loading.end = t;
          this.stats.loaded = size;
          this.stats.total = size;
          callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
        },
        (err: unknown) => {
          if (this.done) return;
          this.done = true;
          this.clearTimer();
          const status = (err as { status?: number })?.status ?? 0;
          const message = err instanceof Error ? err.message : String(err);
          callbacks.onError({ code: status, text: message }, context, null, this.stats);
        },
      );
    }

    private fetchBytes(context: LoaderContext): Promise<ArrayBuffer> {
      const { rangeStart, rangeEnd } = context;
      // Every media request in a stitched playlist is a byte range. One with
      // no range would be the whole file — a download by another name.
      if (rangeStart === undefined || rangeEnd === undefined || rangeEnd <= rangeStart) {
        return Promise.reject(new Error("refusing a whole-file request"));
      }
      // hls.js's `rangeEnd` is exclusive; `fetchRange` takes inclusive ends.
      return source.fetchRange(context.url, rangeStart, rangeEnd - 1);
    }

    private clearTimer(): void {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }
  };
}
