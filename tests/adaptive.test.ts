/**
 * The stitched HD stream (`adaptive.ts`) and its hls.js loader.
 *
 * The `sidx` boxes here are built by hand from the ISO BMFF layout, because a
 * real one needs a live googlevideo URL; `npm run smoke` covers the live shape.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlaylists,
  relinkingFetch,
  segmentAt,
  parseSidx,
  pickPair,
  resolveHd,
  streamFromPair,
  virtualBase,
  withRange,
} from "../src/adaptive.ts";
import type { AdaptiveFormat, ClientAnswer } from "../src/adaptive.ts";
import { virtualLoader } from "../src/virtual-loader.ts";

/** A version-0 sidx box: `refs` are [size, durationInTimescaleUnits]. */
function sidx(refs: [number, number][], timescale = 1000, firstOffset = 0, version = 0): ArrayBuffer {
  const head = version === 0 ? 32 : 40;
  const size = head + refs.length * 12;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint32(0, size);
  "sidx".split("").forEach((c, i) => v.setUint8(4 + i, c.charCodeAt(0)));
  v.setUint8(8, version);
  v.setUint32(12, 1); // reference_ID
  v.setUint32(16, timescale);
  let p = 20;
  if (version === 0) {
    v.setUint32(p, 0);
    v.setUint32(p + 4, firstOffset);
    p += 8;
  } else {
    v.setBigUint64(p, 0n);
    v.setBigUint64(p + 8, BigInt(firstOffset));
    p += 16;
  }
  v.setUint16(p, 0);
  v.setUint16(p + 2, refs.length);
  p += 4;
  for (const [s, d] of refs) {
    v.setUint32(p, s);
    v.setUint32(p + 4, d);
    v.setUint32(p + 8, 0x90000000);
    p += 12;
  }
  return buf;
}

const EXPIRE = 1_900_000_000;
const url = (itag: number) => `https://rr1.googlevideo.com/videoplayback?itag=${itag}&expire=${EXPIRE}`;

const formats: AdaptiveFormat[] = [
  { itag: 313, url: url(313), mimeType: 'video/webm; codecs="vp9"', height: 2160, bitrate: 9e6, initRange: { start: "0", end: "200" }, indexRange: { start: "201", end: "900" } },
  { itag: 137, url: url(137), mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, fps: 30, bitrate: 4e6, initRange: { start: "0", end: "740" }, indexRange: { start: "741", end: "800" } },
  { itag: 136, url: url(136), mimeType: 'video/mp4; codecs="avc1.4d401f"', width: 1280, height: 720, fps: 30, bitrate: 2e6, initRange: { start: "0", end: "740" }, indexRange: { start: "741", end: "800" } },
  { itag: 140, url: url(140), mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130e3, initRange: { start: "0", end: "631" }, indexRange: { start: "632", end: "700" } },
  { itag: 139, url: url(139), mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 50e3, initRange: { start: "0", end: "631" }, indexRange: { start: "632", end: "700" } },
  { itag: 251, url: url(251), mimeType: 'audio/webm; codecs="opus"', bitrate: 160e3 },
];

test("pickPair takes the highest H.264 at or under the cap and the best AAC", () => {
  const pair = pickPair(formats);
  assert.equal(pair?.video.height, 1080);
  assert.equal(pair?.video.codecs, "avc1.640028");
  assert.equal(pair?.audio.codecs, "mp4a.40.2");
  assert.deepEqual(pair?.video.index, { start: 741, end: 800 });
  assert.equal(pickPair(formats, 720)?.video.height, 720);
});

test("pickPair refuses when only 360p, no audio, or no ranges", () => {
  assert.equal(pickPair(formats, 360), null);
  assert.equal(pickPair(formats.filter((f) => !f.mimeType?.startsWith("audio"))), null);
  assert.equal(pickPair(formats.map((f) => ({ ...f, indexRange: undefined }))), null);
  // A ciphered format has no url and is skipped, not unwrapped.
  const ciphered = formats.map((f) => (f.itag === 137 ? { ...f, url: undefined } : f));
  assert.equal(pickPair(ciphered)?.video.height, 720);
});

test("parseSidx turns references into file offsets and seconds", () => {
  const box = sidx([[1000, 5000], [2000, 5005], [500, 1200]], 1000, 10);
  const segs = parseSidx(box, 741);
  const first = 741 + box.byteLength + 10;
  assert.deepEqual(segs, [
    { offset: first, length: 1000, duration: 5 },
    { offset: first + 1000, length: 2000, duration: 5.005 },
    { offset: first + 3000, length: 500, duration: 1.2 },
  ]);
});

test("parseSidx reads version 1 and refuses a nested index", () => {
  assert.equal(parseSidx(sidx([[10, 1000]], 1000, 0, 1), 0)[0].offset, 40 + 12);
  const nested = sidx([[0x80000000 | 10, 1000]]);
  assert.throws(() => parseSidx(nested, 0), /nested/);
  assert.throws(() => parseSidx(new ArrayBuffer(4), 0), /no sidx/);
});

test("pickPair builds a ladder, one rung per height, best first", () => {
  const pair = pickPair(formats)!;
  assert.deepEqual(pair.ladder.map((t) => t.height), [1080, 720]);
  assert.equal(pair.video, pair.ladder[0]);
});

test("buildPlaylists writes a VOD master, lowest rung first, with alternate audio", () => {
  const pair = pickPair(formats)!;
  const v = parseSidx(sidx([[1000, 5000], [2000, 4000]]), 741);
  const a = parseSidx(sidx([[100, 5000], [200, 4000]]), 632);
  const base = virtualBase("abcdefghijk");
  const { master, files } = buildPlaylists(
    "abcdefghijk",
    pair.ladder.map((track) => ({ track, segments: v })),
    { track: pair.audio, segments: a },
  );
  assert.equal(master, `${base}master.m3u8`);
  assert.match(files[master], /CODECS="avc1\.640028,mp4a\.40\.2"/);
  assert.ok(files[master].indexOf("1280x720") < files[master].indexOf("1920x1080"), "lowest rung must be level 0");
  const video = files[`${base}video-1080.m3u8`];
  assert.match(video, /#EXT-X-MAP:URI="[^"]+itag=137[^"]*",BYTERANGE="741@0"/);
  assert.match(video, /#EXT-X-TARGETDURATION:5\n/);
  assert.match(video, new RegExp(`#EXT-X-BYTERANGE:1000@${741 + 32 + 2 * 12}\n`));
  assert.match(video, /#EXT-X-ENDLIST/);
  assert.match(files[`${base}video-720.m3u8`], /itag=136/);
  assert.match(files[`${base}audio.m3u8`], /BYTERANGE="632@0"/);
});

/** Serves a sidx for any index-range request; everything else is bytes. */
function fakeFetch(log: string[], refuse = false) {
  return async (u: string, start: number, end: number, ua?: string): Promise<ArrayBuffer> => {
    log.push(`${u.match(/itag=(\d+)/)?.[1]}:${start}-${end}:${ua ?? ""}`);
    if (refuse) throw Object.assign(new Error("HTTP 403"), { status: 403 });
    return sidx([[1000, 5000], [1000, 5000]]);
  };
}

test("streamFromPair reads both indexes with the client's UA and expires with the URLs", async () => {
  const log: string[] = [];
  const stream = await streamFromPair("abcdefghijk", pickPair(formats)!, fakeFetch(log), "UA");
  // Both indexes, the 720p index, then a small read past the first minute of
  // the top rung and the sound (the fake's two segments: the last one).
  assert.deepEqual(log.sort(), ["136:741-800:UA", "137:1797-2796:UA", "137:741-800:UA", "140:1688-2687:UA", "140:632-700:UA"]);
  assert.equal(stream.mode, "quality");
  assert.equal(stream.isHls, true);
  assert.equal(stream.height, 1080);
  assert.ok(stream.virtual?.files[stream.url]);
  assert.ok(stream.expiresAt < EXPIRE * 1000);
});

test("streamFromPair drops a lower rung that refuses, but not the top one", async () => {
  const pair = pickPair(formats)!;
  const only = (bad: string) => async (u: string, s: number, e: number) => {
    if (u.includes(`itag=${bad}`)) throw new Error("HTTP 403");
    return fakeFetch([])(u, s, e);
  };
  const stream = await streamFromPair("abcdefghijk", pair, only("136"));
  assert.ok(stream.virtual!.files[`${virtualBase("abcdefghijk")}video-1080.m3u8`]);
  assert.equal(stream.virtual!.files[`${virtualBase("abcdefghijk")}video-720.m3u8`], undefined);
  await assert.rejects(streamFromPair("abcdefghijk", pair, only("137")), /403/);
});

test("resolveHd falls through clients, then to an HLS manifest, then throws", async () => {
  const answer = (over: Partial<ClientAnswer> = {}): ClientAnswer => ({
    adaptiveFormats: formats,
    hlsManifestUrl: null,
    ua: "UA",
    ...over,
  });

  // First client refuses its bytes, second serves.
  let calls = 0;
  const flaky = async (u: string, s: number, e: number, ua?: string) => {
    calls += 1;
    if (calls <= 2) throw new Error("HTTP 403");
    return fakeFetch([])(u, s, e, ua);
  };
  const ok = await resolveHd("abcdefghijk", ["android", "ios"], async () => answer(), flaky);
  assert.ok(ok.virtual);

  // No pair anywhere, but one client had a manifest.
  const hls = await resolveHd(
    "abcdefghijk",
    ["android", "ios"],
    async (c) => (c === "ios" ? answer({ adaptiveFormats: [], hlsManifestUrl: "https://m/x.m3u8" }) : null),
    fakeFetch([]),
  );
  assert.equal(hls.url, "https://m/x.m3u8");
  assert.equal(hls.virtual, undefined);

  await assert.rejects(
    resolveHd("abcdefghijk", ["android"], async () => answer(), fakeFetch([], true)),
    /no HD stream \(android: HTTP 403\)/,
  );
});

test("segmentAt finds the segment at or past a time, else the last", () => {
  const segs = [0, 1, 2, 3].map((i) => ({ offset: i * 10, length: 10, duration: 40 }));
  assert.equal(segmentAt(segs, 90).offset, 30); // starts at 120 s
  assert.equal(segmentAt(segs, 0).offset, 0);
  assert.equal(segmentAt(segs, 999).offset, 30);
});

test("a pair that serves only its opening is refused at resolve, and the next client plays", async () => {
  // The first client's files answer the index and the opening, then 403 —
  // the stall near 55 s. The second client's serve throughout.
  const openingOnly = async (u: string, s: number, e: number, ua?: string) => {
    if (ua === "A" && s > 1000) throw Object.assign(new Error("HTTP 403"), { status: 403 });
    return fakeFetch([])(u, s, e, ua);
  };
  await assert.rejects(streamFromPair("abcdefghijk", pickPair(formats)!, openingOnly, "A"), /serves only the opening \(HTTP 403\)/);
  const stream = await resolveHd(
    "abcdefghijk",
    ["android", "ios"],
    async (c) => ({ adaptiveFormats: formats, hlsManifestUrl: null, ua: c === "android" ? "A" : "B" }),
    openingOnly,
  );
  assert.ok(stream.virtual);
});

/** Tracks for `relinkingFetch`, and a fresh answer naming the same itags. */
const tracks = () => {
  const pair = pickPair(formats)!;
  return [...pair.ladder, pair.audio];
};
const freshFormats = formats.map((f) => ({ ...f, url: f.url?.replace("rr1", "rr9") }));

test("a refused link is re-linked to the same file from a fresh answer, once for every track", async () => {
  const log: string[] = [];
  let asks = 0;
  const fetch = async (u: string, s: number, e: number, ua?: string) => {
    log.push(`${u.includes("rr9") ? "new" : "old"}:${u.match(/itag=(\d+)/)?.[1]}:${ua}`);
    if (u.includes("rr1")) throw Object.assign(new Error("HTTP 403"), { status: 403 });
    return new ArrayBuffer(e - s + 1);
  };
  const ranged = relinkingFetch(tracks(), fetch, "A", {
    clients: ["android"],
    ask: async () => ((asks += 1), { adaptiveFormats: freshFormats, hlsManifestUrl: null, ua: "B" }),
  });
  // Video and sound refused at once: one ask, both re-linked.
  const [v, a] = await Promise.all([ranged(url(137), 5000, 5999), ranged(url(140), 5000, 5999)]);
  assert.equal(v.byteLength, 1000);
  assert.equal(a.byteLength, 1000);
  assert.equal(asks, 1);
  // Later reads go straight to the new link with the new client's UA.
  log.length = 0;
  await ranged(url(136), 0, 9);
  assert.deepEqual(log, ["new:136:B"]);
});

test("re-linking tries the next client, and gives up for good when none serves", async () => {
  const served = (bad: string[]) => async (u: string, s: number, e: number, ua?: string) => {
    if (bad.includes(ua ?? "")) throw Object.assign(new Error("HTTP 403"), { status: 403 });
    return new ArrayBuffer(e - s + 1);
  };
  let asks = 0;
  const reask = (bad: string[]) => ({
    clients: ["android", "ios"],
    ask: async (c: string) => ((asks += 1), { adaptiveFormats: freshFormats, hlsManifestUrl: null, ua: c === "android" ? "A" : "I" }),
  });
  // The same client is refused again; the other serves.
  const ok = relinkingFetch(tracks(), served(["A"]), "A", reask(["A"]));
  assert.equal((await ok(url(137), 0, 9)).byteLength, 10);

  // Nobody serves: the refusal goes through, and the next one does not ask.
  asks = 0;
  const no = relinkingFetch(tracks(), served(["A", "I"]), "A", reask(["A", "I"]));
  await assert.rejects(no(url(137), 0, 9), /403/);
  assert.equal(asks, 2);
  await assert.rejects(no(url(137), 0, 9), /403/);
  assert.equal(asks, 2);
});

test("a dropped connection is not re-linked: hls.js retries it", async () => {
  let asks = 0;
  const ranged = relinkingFetch(tracks(), async () => { throw new Error("net::ERR_CONNECTION_RESET"); }, "A", {
    clients: ["android"],
    ask: async () => ((asks += 1), null),
  });
  await assert.rejects(ranged(url(137), 0, 9), /RESET/);
  assert.equal(asks, 0);
});

test("a cancel during a re-link is not a dead link, and keeps the fresh answer", async () => {
  let asks = 0;
  const controller = new AbortController();
  const fetch = async (u: string, s: number, e: number, _ua?: string, io?: { signal?: AbortSignal }) => {
    if (io?.signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    if (u.includes("rr1")) throw Object.assign(new Error("HTTP 403"), { status: 403 });
    return new ArrayBuffer(e - s + 1);
  };
  const ranged = relinkingFetch(tracks(), fetch, "A", {
    clients: ["android", "ios"],
    ask: async () => {
      asks += 1;
      controller.abort(); // the player jumps away while the clients are asked
      return { adaptiveFormats: freshFormats, hlsManifestUrl: null, ua: "B" };
    },
  });
  await assert.rejects(ranged(url(137), 0, 9, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(asks, 1);
  // Not marked dead, and the fresh answer was kept: the next read goes to it.
  assert.equal((await ranged(url(137), 0, 9)).byteLength, 10);
  assert.equal(asks, 1);
});

test("withRange adds or replaces the range parameter", () => {
  assert.equal(withRange("https://x/v?a=1", 0, 9), "https://x/v?a=1&range=0-9");
  assert.equal(withRange("https://x/v?range=5-6&a=1", 0, 9), "https://x/v?a=1&range=0-9");
  assert.equal(withRange("https://x/v?a=1&range=5-6", 0, 9), "https://x/v?a=1&range=0-9");
});

function callbacks() {
  const events: string[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  return {
    events,
    done,
    cb: {
      onSuccess: (res: { data?: unknown }) => {
        events.push(`ok:${typeof res.data === "string" ? "text" : (res.data as ArrayBuffer).byteLength}`);
        resolveDone();
      },
      onError: (e: { code: number; text: string }) => {
        events.push(`err:${e.code}`);
        resolveDone();
      },
      onTimeout: () => {
        events.push("timeout");
        resolveDone();
      },
    },
  };
}

const loaderConfig = { loadPolicy: { maxLoadTimeMs: 1000 }, timeout: 0 } as never;

test("the loader answers playlists from memory and media as inclusive ranges", async () => {
  const fetched: string[] = [];
  const Loader = virtualLoader({
    files: { "https://ytfree.invalid/x/master.m3u8": "#EXTM3U" },
    fetchRange: async (u, s, e) => {
      fetched.push(`${u}:${s}-${e}`);
      return new ArrayBuffer(e - s + 1);
    },
  });

  const a = callbacks();
  new Loader({} as never).load({ url: "https://ytfree.invalid/x/master.m3u8", responseType: "text" }, loaderConfig, a.cb as never);
  await a.done;
  assert.deepEqual(a.events, ["ok:text"]);

  const b = callbacks();
  new Loader({} as never).load(
    { url: "https://g/v", responseType: "arraybuffer", rangeStart: 100, rangeEnd: 200 },
    loaderConfig,
    b.cb as never,
  );
  await b.done;
  assert.deepEqual(fetched, ["https://g/v:100-199"]);
  assert.deepEqual(b.events, ["ok:100"]);

  // A request with no range would be the whole file: refused.
  const c = callbacks();
  new Loader({} as never).load({ url: "https://g/v", responseType: "arraybuffer" }, loaderConfig, c.cb as never);
  await c.done;
  assert.deepEqual(c.events, ["err:0"]);
});

test("the loader reports the HTTP status and stays quiet after abort", async () => {
  const Loader = virtualLoader({
    files: {},
    fetchRange: async () => {
      throw Object.assign(new Error("HTTP 403"), { status: 403 });
    },
  });
  const a = callbacks();
  new Loader({} as never).load({ url: "https://g/v", responseType: "arraybuffer", rangeStart: 0, rangeEnd: 10 }, loaderConfig, a.cb as never);
  await a.done;
  assert.deepEqual(a.events, ["err:403"]);

  const b = callbacks();
  const loader = new Loader({} as never);
  loader.load({ url: "https://g/v", responseType: "arraybuffer", rangeStart: 0, rangeEnd: 10 }, loaderConfig, b.cb as never);
  loader.abort();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(b.events, []);
});

test("an aborted load cancels its download and tells hls.js it was aborted (GitHub #23)", async () => {
  let signal: AbortSignal | undefined;
  const Loader = virtualLoader({
    files: {},
    fetchRange: (_u, _s, _e, io) =>
      new Promise((_resolve, reject) => {
        signal = io?.signal;
        io?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })));
      }),
  });
  const a = callbacks();
  const events = a.events;
  const loader = new Loader({} as never);
  loader.load(
    { url: "https://g/v", responseType: "arraybuffer", rangeStart: 0, rangeEnd: 10 },
    loaderConfig,
    { ...a.cb, onAbort: () => events.push("abort") } as never,
  );
  assert.equal(signal?.aborted, false);
  loader.abort();
  assert.equal(signal?.aborted, true, "the download is cancelled");
  assert.equal(loader.stats.aborted, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(events, ["abort"], "one onAbort, and the cancel's rejection is not an error");

  // destroy() cancels too, silently, as hls.js's own loader does.
  const b = callbacks();
  const quiet = new Loader({} as never);
  quiet.load(
    { url: "https://g/v", responseType: "arraybuffer", rangeStart: 0, rangeEnd: 10 },
    loaderConfig,
    { ...b.cb, onAbort: () => b.events.push("abort") } as never,
  );
  quiet.destroy();
  assert.equal(signal?.aborted, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(b.events, []);
});

test("the loader reports first byte and bytes so far while a segment downloads (GitHub #23)", async () => {
  let progress!: (n: number) => void;
  let finish!: () => void;
  const Loader = virtualLoader({
    files: {},
    fetchRange: (_u, s, e, io) =>
      new Promise((resolve) => {
        progress = (n) => io?.onProgress?.(n);
        finish = () => resolve(new ArrayBuffer(e - s + 1));
      }),
  });
  const a = callbacks();
  const loader = new Loader({} as never);
  loader.load({ url: "https://g/v", responseType: "arraybuffer", rangeStart: 0, rangeEnd: 1000 }, loaderConfig, a.cb as never);
  const { stats } = loader;
  // The size is known up front, nothing loaded, no first byte yet.
  assert.equal(stats.total, 1000);
  assert.equal(stats.loaded, 0);
  assert.equal(stats.loading.first, 0);
  await new Promise((r) => setTimeout(r, 5));
  progress(400);
  const first = stats.loading.first;
  assert.ok(first > stats.loading.start, "first byte is after the start, not the start");
  assert.equal(stats.loaded, 400);
  assert.notEqual(stats.loaded, stats.total, "hls.js reads loaded === total as finished");
  progress(700);
  assert.equal(stats.loading.first, first, "the first byte is stamped once");
  assert.equal(stats.loaded, 700);
  finish();
  await a.done;
  assert.deepEqual(a.events, ["ok:1000"]);
  assert.equal(stats.loading.first, first);
  assert.equal(stats.loaded, 1000);
});

test("a late answer to a superseded load never reaches the next load", async () => {
  const pending: ((b: ArrayBuffer) => void)[] = [];
  const Loader = virtualLoader({
    files: {},
    fetchRange: () => new Promise((resolve) => pending.push(resolve)),
  });
  const loader = new Loader({} as never);
  const a = callbacks();
  loader.load({ url: "https://g/v", responseType: "arraybuffer", rangeStart: 0, rangeEnd: 10 }, loaderConfig, a.cb as never);
  const b = callbacks();
  loader.load({ url: "https://g/v", responseType: "arraybuffer", rangeStart: 20, rangeEnd: 40 }, loaderConfig, b.cb as never);
  pending[0](new ArrayBuffer(10));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(a.events, []);
  assert.deepEqual(b.events, []);
  pending[1](new ArrayBuffer(20));
  await b.done;
  assert.deepEqual(b.events, ["ok:20"]);
});

test("pickPair keeps the original language over a higher-bitrate dub", () => {
  const dubbed: AdaptiveFormat[] = [
    formats[1],
    { ...formats[3], url: url(140) + "&lang=es", bitrate: 200e3, audioTrack: { id: "es.3", displayName: "Spanish", audioIsDefault: false } },
    { ...formats[3], url: url(140) + "&lang=en", bitrate: 130e3, audioTrack: { id: "en.4", displayName: "English original", audioIsDefault: true } },
    { ...formats[3], url: url(140) + "&lang=de", bitrate: 210e3, xtags: "acont=dubbed-auto" },
  ];
  assert.match(pickPair(dubbed)!.audio.url, /lang=en/);
  // No default flag at all: "original" still wins.
  const noDefault = dubbed.map((f) => (f.audioTrack ? { ...f, audioTrack: { ...f.audioTrack, audioIsDefault: false } } : f));
  assert.match(pickPair(noDefault)!.audio.url, /lang=en/);
});
