/**
 * A byte range of a googlevideo file over Node's `https`, for HD on desktop.
 *
 * `requestUrl` answers only once the whole range is in, and cannot be
 * cancelled. That costs a stitched stream twice on a jump (GitHub #23): the
 * 1080p segment hls.js gave up on keeps downloading and competes with the
 * segment the player is landing on, and hls.js's bandwidth estimate and
 * abandon rule see no bytes until the end. This request streams, so it reports
 * bytes as they arrive (`io.onProgress`), and `io.signal` tears it down.
 *
 * Node in the renderer has no CORS, which is the other reason the renderer's
 * `fetch` is no use here. The phone has no Node and keeps `requestUrl`.
 */

import * as http from "http";
import * as https from "https";
import { abortError, isAbort, withRange } from "../adaptive.ts";
import type { FetchRange } from "../adaptive.ts";
import type { RangeIO } from "../stream.ts";

/** googlevideo hands out a redirect now and then; more than this is a loop. */
const MAX_REDIRECTS = 3;

/** An HTTP answer outside 2xx: the same shape `hd.ts` throws. */
function refusal(status: number): Error & { status: number } {
  const err = new Error(`googlevideo answered HTTP ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

function get(url: string, ua: string | undefined, io: RangeIO | undefined, redirects: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const signal = io?.signal;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const lib = url.startsWith("http:") ? http : https;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const req = lib.get(url, { headers: ua ? { "User-Agent": ua } : {} }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects < MAX_REDIRECTS) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        finish(() => get(next, ua, io, redirects + 1).then(resolve, reject));
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        finish(() => reject(refusal(status)));
        return;
      }
      const chunks: Buffer[] = [];
      let loaded = 0;
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        chunks.push(chunk);
        loaded += chunk.length;
        io?.onProgress?.(loaded);
      });
      res.on("end", () => {
        finish(() => {
          const all = Buffer.concat(chunks, loaded);
          // A Buffer can sit inside a larger shared pool: copy out exactly its bytes.
          resolve(all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer);
        });
      });
      res.on("error", (err) => finish(() => reject(err)));
      res.on("aborted", () => finish(() => reject(new Error("googlevideo closed the connection"))));
    });
    const onAbort = () => {
      finish(() => reject(abortError()));
      req.destroy();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => finish(() => reject(err)));
  });
}

/** Inclusive byte range `[start, end]`, streamed and cancellable. */
export const streamingFetchRange: FetchRange = (url, start, end, ua, io) =>
  get(withRange(url, start, end), ua, io, 0);

/**
 * The streaming request, with `fallback` (`requestUrl`) for any request it
 * cannot make at all — a TLS or proxy setup Node does not share with the app,
 * say. A refusal or a cancel is an answer and goes straight through; only a
 * failure with no HTTP status is retried, once, the old way.
 */
export function streamingWithFallback(fallback: FetchRange, primary: FetchRange = streamingFetchRange): FetchRange {
  return async (url, start, end, ua, io) => {
    try {
      return await primary(url, start, end, ua, io);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== undefined || isAbort(err) || io?.signal?.aborted) throw err;
      return fallback(url, start, end, ua, io);
    }
  };
}
