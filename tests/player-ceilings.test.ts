/**
 * Request ceilings for Play and HD, at the level of the player (GitHub #66,
 * sub-point 1; scope: docs/V1-SCOPE-BOT-SAFE.md §2).
 *
 * request-ceilings.test.ts counts what single InnerTube calls cost. This one
 * counts what a reader's action costs end to end: the real `YtFreePlayer`,
 * the real provider (`play-provider.ts`, the same code the plugin runs), the
 * real `InfoCache` and `StreamCache`, and the real HD resolver reading file
 * headers from the replay fixture (#38). Only the network is fake, and it
 * counts.
 *
 *   Opening a note (the player mounted, nothing pressed)   0
 *   Play on a desktop with yt-dlp                          1 yt-dlp run + 2 byte reads
 *   Play on a phone (own stream)                           1 player call
 *
 * The player needs a DOM, so happy-dom stands in for Electron, with the few
 * helpers Obsidian adds to every element. `obsidian` and `hls.js` are stubbed:
 * hls.js would start fetching the stream's segments, which is playback, not
 * the resolve these ceilings are about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { GlobalWindow } from "happy-dom";
import { transformSync } from "esbuild";

// ---- A DOM with Obsidian's element helpers ---------------------------------

const win = new GlobalWindow({ url: "app://obsidian.md/" });
const g = globalThis as Record<string, unknown>;
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLMediaElement", "HTMLVideoElement",
  "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "PointerEvent", "MouseEvent",
  "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "DocumentFragment", "Audio",
]) {
  if (!(key in g) || key === "navigator") {
    Object.defineProperty(g, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
  }
}
g.activeWindow = win;
g.activeDocument = win.document;

interface DomInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  type?: string;
  value?: string;
}
type El = HTMLElement & Record<string, unknown>;
const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
function applyInfo(el: El, info?: DomInfo | string): void {
  if (typeof info === "string") info = { cls: info };
  if (!info) return;
  const cls = info.cls;
  if (cls) el.classList.add(...(Array.isArray(cls) ? cls : cls.split(" ").filter(Boolean)));
  if (info.text !== undefined) el.textContent = info.text;
  if (info.title !== undefined) el.title = info.title;
  if (info.type !== undefined) el.setAttribute("type", info.type);
  if (info.value !== undefined) (el as unknown as { value: string }).value = info.value;
  for (const [k, v] of Object.entries(info.attr ?? {})) {
    if (v === null || v === false) continue;
    el.setAttribute(k, v === true ? "" : String(v));
  }
}
proto.createEl = function (this: El, tag: string, info?: DomInfo, cb?: (el: El) => void) {
  const el = win.document.createElement(tag) as unknown as El;
  applyInfo(el, info);
  this.appendChild(el);
  cb?.(el);
  return el;
};
proto.createDiv = function (this: El, info?: DomInfo, cb?: (el: El) => void) {
  return (this.createEl as (t: string, i?: DomInfo, c?: (el: El) => void) => El)("div", info, cb);
};
proto.createSpan = function (this: El, info?: DomInfo, cb?: (el: El) => void) {
  return (this.createEl as (t: string, i?: DomInfo, c?: (el: El) => void) => El)("span", info, cb);
};
proto.addClass = function (this: El, ...cls: string[]) { this.classList.add(...cls); };
proto.removeClass = function (this: El, ...cls: string[]) { this.classList.remove(...cls); };
proto.toggleClass = function (this: El, cls: string | string[], on: boolean) {
  for (const c of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(c, on);
};
proto.hasClass = function (this: El, cls: string) { return this.classList.contains(cls); };
proto.empty = function (this: El) { this.replaceChildren(); };
proto.setText = function (this: El, text: string) { this.textContent = text; };
proto.setAttr = function (this: El, name: string, value: string | number | boolean | null) {
  if (value === null || value === false) this.removeAttribute(name);
  else this.setAttribute(name, value === true ? "" : String(value));
};
proto.find = function (this: El, selector: string) { return this.querySelector(selector); };

// happy-dom's media element neither loads nor plays. `play()` fires `play`, as
// a browser does once a source exists; nothing here waits on media events.
const media = win.HTMLMediaElement.prototype as unknown as Record<string, unknown>;
media.play = function (this: HTMLMediaElement) {
  this.dispatchEvent(new win.Event("play") as unknown as Event);
  return Promise.resolve();
};
media.load = function () { /* nothing to load */ };
media.canPlayType = () => "";

// ---- obsidian and hls.js ---------------------------------------------------

/** Requests sent through Obsidian's `requestUrl` (InnerTube, phone path). */
const requestUrlSent: string[] = [];
g.__ytfreeRequestUrl = (req: { url: string }) => {
  requestUrlSent.push(req.url);
  const body = JSON.parse(readFileSync(new URL("./fixtures/player-android-ok.json", import.meta.url), "utf8")) as unknown;
  return Promise.resolve({ status: 200, text: JSON.stringify(body), json: body });
};
g.__ytfreeMobile = false;

const OBSIDIAN = `data:text/javascript,${encodeURIComponent(`
  export const requestUrl = (req) => globalThis.__ytfreeRequestUrl(req);
  export const Platform = { get isMobile() { return globalThis.__ytfreeMobile; }, get isDesktop() { return !globalThis.__ytfreeMobile; }, isIosApp: false, isAndroidApp: false, isMacOS: false };
  export const setIcon = () => {};
  export const addIcon = () => {};
`)}`;
/** hls.js that attaches and does nothing else. `created` counts instances. */
const HLS = `data:text/javascript,${encodeURIComponent(`
  export default class Hls {
    static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: "m", LEVEL_SWITCHED: "l", ERROR: "e", FRAG_LOADED: "f", LEVEL_LOADED: "ll" };
    static ErrorTypes = { NETWORK_ERROR: "n", MEDIA_ERROR: "me" };
    constructor() { globalThis.__ytfreeHls = (globalThis.__ytfreeHls ?? 0) + 1; this.levels = []; this.autoLevelEnabled = true; }
    on() {} once() {} off() {} loadSource() {} attachMedia() {} detachMedia() {} destroy() {}
    startLoad() {} stopLoad() {} recoverMediaError() {}
  }
`)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "obsidian") return { url: OBSIDIAN, shortCircuit: true };
    if (specifier === "hls.js") return { url: HLS, shortCircuit: true };
    return next(specifier, context);
  },
  // player.ts uses constructor parameter properties, which Node's type
  // stripping refuses. esbuild (already the build tool) compiles the plugin's
  // own sources instead, so the next file to use one does not break this test.
  load(url, context, next) {
    if (!url.startsWith("file:") || !url.includes("/src/") || !url.endsWith(".ts")) return next(url, context);
    const source = readFileSync(new URL(url), "utf8");
    const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2022" });
    return { format: "module", source: code, shortCircuit: true };
  },
});

const { YtFreePlayer } = await import("../src/player.ts");
const { cachedProvider, desktopResolve, mobileResolve } = await import("../src/play-provider.ts");
const { TierFailures } = await import("../src/tier-failures.ts");
const { InfoCache } = await import("../src/info-cache.ts");
const { StreamCache } = await import("../src/stream.ts");
const { infoExpiresAt } = await import("../src/ytdlp-info.ts");
const { resolveHdFromYtDlpFormats } = await import("../src/hd.ts");
const { forgetPlayer } = await import("../src/innertube.ts");
const { resolveMobileStream } = await import("../src/mobile/innertube.ts");
const { YtDlpMissingError } = await import("../src/stream.ts");
const { botCheck } = await import("../src/bot-check.ts");
const { replayFetch } = await import("../tools/fixture-format.ts");
type YtDlpInfo = import("../src/ytdlp-info.ts").YtDlpInfo;
type StreamProvider = import("../src/stream.ts").StreamProvider;
type FetchRange = import("../src/adaptive.ts").FetchRange;

// ---- The replay fixture, counted -------------------------------------------

const REPLAY = new URL("./fixtures/replay/synthetic/", import.meta.url);
const info = JSON.parse(readFileSync(new URL("ytdlp.json", REPLAY), "utf8")) as YtDlpInfo;
const VIDEO = "synthetic01";
const BYTES: Record<string, Uint8Array> = {};
for (const file of readdirSync(new URL("bytes/", REPLAY))) {
  BYTES[file.replace(/\.bin$/, "")] = new Uint8Array(readFileSync(new URL(`bytes/${file}`, REPLAY)));
}

interface Count {
  ytDlp: number;
  reads: number;
  innertubeFast: number;
  innertubeHd: number;
}

/** A desktop provider wired as the plugin wires it, with yt-dlp and the network faked. */
function desktopRig(withYtDlp = true): { provider: StreamProvider; count: Count; notices: () => number } {
  const count: Count = { ytDlp: 0, reads: 0, innertubeFast: 0, innertubeHd: 0 };
  let unavailable = false;
  let notices = 0;
  const infoCache = new InfoCache<YtDlpInfo>(() => Date.now(), 15);
  const replay = replayFetch(BYTES);
  const reads: FetchRange = (url, start, end, ua, io) => {
    count.reads++;
    return replay(url, start, end, ua, io);
  };
  const provider = cachedProvider(
    VIDEO,
    new StreamCache(),
    desktopResolve(VIDEO, {
      ytDlpInfo: (id) =>
        infoCache.get(id, () => {
          count.ytDlp++;
          if (!withYtDlp) return Promise.reject(new YtDlpMissingError());
          // A real run takes a while; concurrent asks must share it.
          return new Promise((resolve) => setTimeout(() => resolve(structuredClone(info)), 5));
        }, infoExpiresAt),
      ytDlpUnavailable: () => unavailable,
      failures: new TierFailures(),
      markYtDlpUnavailable: () => {
        assert.equal(withYtDlp, false, "yt-dlp is there");
        unavailable = true;
      },
      innertubeFast: () => {
        count.innertubeFast++;
        if (withYtDlp) return Promise.reject(new Error("not on a desktop with yt-dlp"));
        return resolveMobileStream(VIDEO);
      },
      innertubeHd: () => {
        count.innertubeHd++;
        return Promise.reject(new Error("not on a desktop with yt-dlp"));
      },
      ytDlpHd: (id, formats, fetch) => resolveHdFromYtDlpFormats(id, formats, undefined, fetch),
      rangeFetch: () => Promise.resolve(reads),
      onPlayingWithoutYtDlp: () => {
        assert.equal(withYtDlp, false, "yt-dlp is there");
        notices++;
      },
    }),
    () => infoCache.invalidate(VIDEO),
  );
  activity = () => JSON.stringify([count, hlsCreated(), requestUrlSent.length]);
  return { provider, count, notices: () => notices };
}

function mount(provider: StreamProvider): InstanceType<typeof YtFreePlayer> {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  return new YtFreePlayer(host as unknown as HTMLElement, provider, () => {}, undefined, {});
}

/**
 * Let resolves, header reads and the player's follow-ups settle: wait until
 * nothing has been sent or attached for several ticks in a row, so a slow CI
 * runner gets as long as it needs rather than a fixed sleep.
 */
let activity = (): string => "";
async function settle(): Promise<void> {
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
  let last = activity();
  let quiet = 0;
  for (let i = 0; i < 250 && quiet < 4; i++) {
    await tick();
    const now = activity();
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
}

/** The poster tap: resolve, then play (main.ts `deferMobileLoad`). */
async function pressPlay(player: InstanceType<typeof YtFreePlayer>, hd: boolean, startInHd = false): Promise<void> {
  await player.load(hd, startInHd);
  player.play();
  await settle();
}

/** hls.js players made since the last test: one per stream attached as HD. */
const hlsCreated = (): number => (g.__ytfreeHls as number | undefined) ?? 0;

const players: { destroy(): void }[] = [];
function track<T extends { destroy(): void }>(p: T): T {
  players.push(p);
  return p;
}
test.afterEach(() => {
  for (const p of players.splice(0)) p.destroy();
  requestUrlSent.length = 0;
  g.__ytfreeMobile = false;
  g.__ytfreeHls = 0;
  botCheck.clear();
});
test.after(() => win.happyDOM.abort().then(() => win.close()));

// ---- Desktop ----------------------------------------------------------------

test("mounting the player (opening a note) costs nothing", async () => {
  const { provider, count } = desktopRig();
  track(mount(provider));
  await settle();
  assert.deepEqual(count, { ytDlp: 0, reads: 0, innertubeFast: 0, innertubeHd: 0 });
});

test("Play with HD on: one yt-dlp run and two byte reads", async () => {
  const { provider, count } = desktopRig();
  const player = track(mount(provider));
  await pressPlay(player, true);
  assert.equal(count.ytDlp, 1, "360p and HD share one yt-dlp -J");
  assert.ok(count.reads > 0 && count.reads <= 2, `HD started in ${count.reads} reads; the ceiling is 2`);
  assert.equal(hlsCreated(), 1, "HD actually attached");
  assert.equal(count.innertubeFast + count.innertubeHd, 0, "no InnerTube on a desktop with yt-dlp");
});

test("HD waits for Play: a load with no Play reads no HD headers", async () => {
  const { provider, count } = desktopRig();
  const player = track(mount(provider));
  await player.load(true, false);
  await settle();
  assert.equal(count.ytDlp, 1);
  assert.equal(count.reads, 0, "no HD before the first Play");
  player.play();
  await settle();
  assert.equal(count.ytDlp, 1);
  assert.ok(count.reads > 0 && count.reads <= 2, `${count.reads} reads after Play`);
});

test("a second Play and a pause cost nothing more", async () => {
  const { provider, count } = desktopRig();
  const player = track(mount(provider));
  await pressPlay(player, true);
  const after = { ...count };
  player.pause();
  player.play();
  player.pause();
  player.play();
  await settle();
  assert.deepEqual(count, after);
});

test("the same video played again in a rebuilt player costs nothing", async () => {
  const { provider, count } = desktopRig();
  await pressPlay(track(mount(provider)), true);
  const after = { ...count };
  // A note re-rendered, or the same video opened in the hub's Preview.
  await pressPlay(track(mount(provider)), true);
  assert.deepEqual(count, after);
});

test("Play with HD off: one yt-dlp run, no HD lookup", async () => {
  const { provider, count } = desktopRig();
  const player = track(mount(provider));
  await pressPlay(player, false);
  assert.deepEqual(count, { ytDlp: 1, reads: 0, innertubeFast: 0, innertubeHd: 0 });
});

test("Start in HD: 360p and HD together still cost one yt-dlp run and two reads", async () => {
  const { provider, count } = desktopRig();
  const player = track(mount(provider));
  await pressPlay(player, true, true);
  assert.equal(count.ytDlp, 1);
  assert.ok(count.reads > 0 && count.reads <= 2, `${count.reads} reads`);
  assert.equal(hlsCreated(), 1, "opened straight in HD");
});

test("toggling Quality before Play does not add a lookup", async () => {
  const { provider, count } = desktopRig();
  const player = track(mount(provider));
  await player.load(true, false);
  player.setQuality(false);
  player.setQuality(true);
  player.setQuality(false);
  player.setQuality(true);
  await settle();
  assert.equal(count.reads, 0, "still waiting for Play");
  player.play();
  await settle();
  assert.equal(count.ytDlp, 1);
  assert.ok(count.reads <= 2, `${count.reads} reads after toggles`);
});

test("Play on a desktop without yt-dlp: one InnerTube player call, asked once for yt-dlp", async () => {
  forgetPlayer(VIDEO);
  const { provider, count, notices } = desktopRig(false);
  const player = track(mount(provider));
  await settle();
  assert.equal(requestUrlSent.length, 0, "mounting costs nothing");
  await pressPlay(player, false);
  assert.equal(count.ytDlp, 1, "yt-dlp looked for once");
  assert.equal(count.innertubeFast, 1);
  assert.equal(requestUrlSent.filter((u) => u.includes("/player")).length, 1);
  assert.equal(notices(), 1, "says why it plays the phone's way");
});

// ---- Phone (own stream) ------------------------------------------------------

test("Play on the phone, HD off: one InnerTube player call", async () => {
  g.__ytfreeMobile = true;
  forgetPlayer(VIDEO);
  const provider = cachedProvider(VIDEO, new StreamCache(), mobileResolve(VIDEO, new TierFailures()), () => forgetPlayer(VIDEO));
  activity = () => JSON.stringify([hlsCreated(), requestUrlSent.length]);
  const player = track(mount(provider));
  await settle();
  assert.equal(requestUrlSent.length, 0, "mounting costs nothing");
  await pressPlay(player, false);
  assert.equal(requestUrlSent.filter((u) => u.includes("/player")).length, 1);
  assert.equal(requestUrlSent.length, 1);
});

// ---- Fallback tiers (#43) ----------------------------------------------------

test("a dead link: yt-dlp once, our own stream once, then YouTube's player; never a third resolve", async () => {
  forgetPlayer(VIDEO);
  const failures = new TierFailures();
  let ytDlp = 0;
  let own = 0;
  const infoCache = new InfoCache<YtDlpInfo>(() => Date.now(), 15);
  const provider = cachedProvider(
    VIDEO,
    new StreamCache(),
    desktopResolve(VIDEO, {
      ytDlpInfo: (id) => infoCache.get(id, () => (ytDlp++, Promise.resolve(structuredClone(info))), infoExpiresAt),
      ytDlpUnavailable: () => false,
      markYtDlpUnavailable: () => assert.fail("yt-dlp is there"),
      failures,
      // The fixture's links are long expired; these are live links that die.
      innertubeFast: () => (own++, resolveMobileStream(VIDEO).then((st) => ({ ...st, expiresAt: Date.now() + 3600_000 }))),
      innertubeHd: () => Promise.reject(new Error("HD is off")),
      ytDlpHd: () => Promise.reject(new Error("HD is off")),
      rangeFetch: () => Promise.reject(new Error("HD is off")),
      onPlayingWithoutYtDlp: () => assert.fail("yt-dlp is there"),
    }),
    () => infoCache.invalidate(VIDEO),
    failures,
  );
  const opened: number[] = [];
  const statuses: (string | null)[] = [];
  const progress: number[] = [];
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  let embedAt = 0;
  let report: ((s: { time: number; duration: number; playing: boolean }) => void) | null = null;
  const player = track(new YtFreePlayer(host as unknown as HTMLElement, provider, (m) => statuses.push(m), undefined, {
    onProgress: (t) => progress.push(t),
    quick: {
      youtubePlayer: (_host, at, _rate, onStatus) => {
        opened.push(at);
        embedAt = at;
        report = onStatus;
        return Promise.resolve({
          close: () => embedAt,
          time: () => embedAt,
          seek: (t: number) => { embedAt = t; },
          play: () => {},
          pause: () => {},
        });
      },
    },
  }));
  activity = () => JSON.stringify([ytDlp, own, opened.length, statuses.length]);
  const kill = (): void => {
    Object.defineProperty(player.video, "error", { value: { code: 4, message: "refused" }, configurable: true });
    player.video.dispatchEvent(new win.Event("error") as unknown as Event);
  };

  await pressPlay(player, false);
  assert.deepEqual([ytDlp, own], [1, 0], "yt-dlp first");

  const until = async (done: () => boolean): Promise<void> => {
    for (let waited = 0; !done() && waited < 5000; waited += 20) await new Promise((r) => setTimeout(r, 20));
  };
  kill(); // yt-dlp's link refused: the retry goes to our own stream, not yt-dlp again
  await until(() => statuses.at(-1) === null); // the refresh finished
  await settle();
  assert.deepEqual([ytDlp, own], [1, 1]);
  assert.equal(opened.length, 0);

  kill(); // our own stream's link refused too: YouTube's player, after the cooldown
  // The second retry waits out the player's 2 s cooldown first.
  await until(() => opened.length > 0);
  await settle();
  assert.deepEqual([ytDlp, own], [1, 1], "no third resolve");
  assert.equal(opened.length, 1, "YouTube's player took over");
  assert.ok(host.classList.contains("is-youtube"), "in place, in the same player");
  assert.ok(!statuses.some((m) => m && /brew|yt-dlp/i.test(m)), "never a yt-dlp message");

  // Timestamps and progress follow YouTube's player.
  player.seekTo(42);
  assert.equal(player.currentTime, 42);
  report!({ time: 42, duration: 100, playing: true });
  assert.ok(progress.includes(42), "progress is reported from YouTube's player");
});

test("which failures go to YouTube's player: all tiers failed, a bot check, a bot-check pause", async () => {
  const { needsYouTubePlayer } = await import("../src/player.ts");
  const { AllTiersFailedError } = await import("../src/tier-failures.ts");
  const { BotCheckPausedError } = await import("../src/bot-check.ts");
  assert.ok(needsYouTubePlayer(new AllTiersFailedError()));
  assert.ok(needsYouTubePlayer(new BotCheckPausedError("paused")));
  assert.ok(needsYouTubePlayer(new Error("Sign in to confirm you’re not a bot")));
  assert.ok(!needsYouTubePlayer(new Error("network")));
  assert.ok(!needsYouTubePlayer(null));
});
