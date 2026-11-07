/**
 * The desktop streaming byte-range request (`desktop/range-fetch.ts`, GitHub
 * #23), against a local server: it reports bytes as they arrive, a cancel
 * tears it down, and a refusal carries its status.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { streamingFetchRange, streamingWithFallback } from "../src/desktop/range-fetch.ts";

async function serve(handler: http.RequestListener): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

test("streams a range, reporting bytes as they arrive, with the client's UA", async () => {
  let seen = { url: "", ua: "" };
  const s = await serve((req, res) => {
    seen = { url: req.url ?? "", ua: String(req.headers["user-agent"]) };
    res.writeHead(200);
    res.write(Buffer.alloc(300, 1));
    setTimeout(() => res.end(Buffer.alloc(200, 2)), 20);
  });
  try {
    const progress: number[] = [];
    const bytes = await streamingFetchRange(`${s.base}/v?a=1`, 100, 599, "UA-X", { onProgress: (n) => progress.push(n) });
    assert.equal(bytes.byteLength, 500);
    assert.equal(new Uint8Array(bytes)[499], 2);
    assert.equal(seen.url, "/v?a=1&range=100-599");
    assert.equal(seen.ua, "UA-X");
    assert.ok(progress.length >= 2, "progress before the end, not only at it");
    assert.ok(progress[0] < 500);
    assert.equal(progress[progress.length - 1], 500);
  } finally {
    await s.close();
  }
});

test("a cancel tears the download down mid-transfer and rejects with AbortError", async () => {
  let closed!: () => void;
  const serverSawClose = new Promise<void>((r) => (closed = r));
  const s = await serve((req, res) => {
    res.writeHead(200);
    res.write(Buffer.alloc(100));
    req.socket.on("close", () => closed()); // never ends on its own
  });
  try {
    const controller = new AbortController();
    const got = streamingFetchRange(`${s.base}/v`, 0, 9999, undefined, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await assert.rejects(got, { name: "AbortError" });
    await serverSawClose;
  } finally {
    await s.close();
  }
});

test("a refusal carries its status, follows a redirect, and is never sent to the fallback", async () => {
  const s = await serve((req, res) => {
    if (req.url?.startsWith("/moved")) {
      res.writeHead(302, { location: "/v?x=1&range=0-3" });
      res.end();
    } else if (req.url?.startsWith("/gone")) {
      res.writeHead(403);
      res.end();
    } else {
      res.writeHead(200);
      res.end(Buffer.alloc(4));
    }
  });
  try {
    assert.equal((await streamingFetchRange(`${s.base}/moved`, 0, 3)).byteLength, 4);
    let fellBack = 0;
    const fetch = streamingWithFallback(async () => ((fellBack += 1), new ArrayBuffer(1)));
    await assert.rejects(fetch(`${s.base}/gone`, 0, 3), (e: { status?: number }) => e.status === 403);
    assert.equal(fellBack, 0);
  } finally {
    await s.close();
  }
});

test("a request Node cannot make at all falls back to the old fetch", async () => {
  let fellBack = 0;
  const fetch = streamingWithFallback(
    async () => ((fellBack += 1), new ArrayBuffer(7)),
    async () => { throw new Error("unable to get local issuer certificate"); },
  );
  assert.equal((await fetch("https://g/v", 0, 6)).byteLength, 7);
  assert.equal(fellBack, 1);
  // Node failed once: later requests go straight to the fallback.
  assert.equal((await fetch("https://g/v", 0, 6)).byteLength, 7);
  assert.equal(fellBack, 2);
  // A connection dropped mid-transfer is hls.js's to retry, not a Node failure.
  const dropped = streamingWithFallback(
    async () => ((fellBack += 1), new ArrayBuffer(7)),
    async (_u, _s, _e, _ua, io) => { io?.onProgress?.(3); throw new Error("googlevideo closed the connection"); },
  );
  await assert.rejects(dropped("https://g/v", 0, 6), /closed/);
  assert.equal(fellBack, 2);
  // A cancel is not a failure: no fallback.
  const cancelled = streamingWithFallback(
    async () => ((fellBack += 1), new ArrayBuffer(7)),
    async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); },
  );
  await assert.rejects(cancelled("https://g/v", 0, 6), { name: "AbortError" });
  assert.equal(fellBack, 2);
});
