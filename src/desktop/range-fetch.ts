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
import { abortError, isAbort, refusal, withRange } from "../adaptive.ts";
import type { FetchRange } from "../adaptive.ts";
import type { RangeIO } from "../stream.ts";

/** googlevideo hands out a redirect now and then; more than this is a loop. */
const MAX_REDIRECTS = 3;

/**
 * Silence on the socket this long ends the request. The loader has its own
 * limit for segments, but the resolve's index and check reads have no other
 * way to end, and a hung one would hold the player on its spinner.
 */
export const IDLE_TIMEOUT_MS = 15_000;

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
        req.destroy();
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
          // A small Buffer can sit inside a larger shared pool: then copy out
          // exactly its bytes. A segment-sized one owns its memory.
          const whole = all.byteOffset === 0 && all.byteLength === all.buffer.byteLength;
          resolve((whole ? all.buffer : all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength)) as ArrayBuffer);
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
    req.setTimeout(IDLE_TIMEOUT_MS, () => {
      finish(() => reject(new Error(`googlevideo sent nothing for ${IDLE_TIMEOUT_MS / 1000} s`)));
      req.destroy();
    });
    req.on("error", (err) => finish(() => reject(err)));
  });
}

/** Inclusive byte range `[start, end]`, streamed and cancellable. */
export const streamingFetchRange: FetchRange = (url, start, end, ua, io) =>
  get(withRange(url, start, end), ua, io, 0);

/**
 * The streaming request, with `fallback` (`requestUrl`) for when Node cannot
 * make the request at all — a TLS or proxy setup it does not share with the
 * app, say. Only a failure before any byte arrived, with no HTTP status, counts:
 * that request goes the old way, and so does every later one for this stream,
 * so a setup Node cannot reach pays the failed attempt once. A refusal, a
 * cancel, or a connection dropped mid-transfer is an answer and goes straight
 * through (hls.js retries the drop).
 */
export function streamingWithFallback(fallback: FetchRange, primary: FetchRange = streamingFetchRange): FetchRange {
  let nodeFails = false;
  return async (url, start, end, ua, io) => {
    if (nodeFails) return fallback(url, start, end, ua, io);
    let loaded = 0;
    const watched: RangeIO = {
      signal: io?.signal,
      onProgress: (n) => {
        loaded = n;
        io?.onProgress?.(n);
      },
    };
    try {
      return await primary(url, start, end, ua, watched);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== undefined || loaded > 0 || isAbort(err) || io?.signal?.aborted) throw err;
      nodeFails = true;
      return fallback(url, start, end, ua, io);
    }
  };
}
