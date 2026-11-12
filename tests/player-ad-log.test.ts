/**
 * GitHub #91: the hosted player page logs "ad seen" / "ad ended" when YouTube
 * reports -1 (unstarted) while the clock runs (a pre-roll), and stays quiet when
 * a reader is just slow to tap play. Runs the page's own script against a fake
 * YouTube player and fake timers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../docs/player/index.html", import.meta.url), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

type Msg = Record<string, unknown>;

function openPage(query = "?v=dQw4w9WgXcQ") {
  let now = 1_000_000;
  const timers: { at: number; every: number; fn: () => void }[] = [];
  const sent: Msg[] = [];
  const yt = { state: -1, time: 0, muted: false };
  const fakePlayer = {
    getPlayerState: () => yt.state,
    getCurrentTime: () => yt.time,
    getDuration: () => 212,
    getPlaybackRate: () => 1,
    getPlaybackQuality: () => "hd720",
    setPlaybackRate() {},
    playVideo() {},
    pauseVideo() {},
    seekTo() {},
    mute() { yt.muted = true; },
    unMute() { yt.muted = false; },
  };
  let events: { onReady: () => void } | null = null;
  const parent = { postMessage: (m: Msg) => sent.push(m) };
  const win: Record<string, unknown> = {
    parent,
    addEventListener() {},
  };
  const ctx = vm.createContext({
    window: win,
    location: { search: query, ancestorOrigins: [] },
    navigator: { userAgent: "test", cookieEnabled: true, maxTouchPoints: 0, language: "en" },
    document: {
      visibilityState: "visible",
      referrer: "",
      body: {},
      head: { appendChild() {} },
      createElement: () => ({}),
      addEventListener() {},
    },
    URLSearchParams,
    Date: { now: () => now },
    Math,
    Number,
    String,
    setTimeout: (fn: () => void, ms: number) => timers.push({ at: now + ms, every: 0, fn }),
    setInterval: (fn: () => void, ms: number) => timers.push({ at: now + ms, every: ms, fn }),
    YT: {
      Player: function (_el: string, opts: { events: { onReady: () => void } }) {
        events = opts.events;
        return fakePlayer;
      },
    },
  });
  vm.runInContext(script, ctx);
  (win.onYouTubeIframeAPIReady as () => void)();
  events!.onReady();

  /** Advance the fake clock, firing timers in order; `clockRate` = video seconds per real second. */
  function run(ms: number, clockRate: number) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      yt.time += ((next.at - now) / 1000) * clockRate;
      now = next.at;
      if (next.every) next.at += next.every;
      else timers.shift();
      next.fn();
    }
    yt.time += ((end - now) / 1000) * clockRate;
    now = end;
  }
  const logs = () => sent.filter((m) => m.type === "log").map((m) => m.event);
  return { yt, run, logs, sent };
}

test("a pre-roll (-1 with the clock running) logs ad seen, then ad ended when the video starts", () => {
  const p = openPage();
  p.run(6000, 1); // 6 s of ad at -1
  assert.equal(p.logs().filter((e) => e === "ad seen").length, 1);
  assert.ok(!p.logs().includes("ad ended"));
  p.yt.state = 1;
  p.yt.time = 0;
  p.run(1000, 1);
  assert.equal(p.logs().filter((e) => e === "ad ended").length, 1);
  const ended = p.sent.find((m) => m.event === "ad ended")!;
  assert.ok((ended.lastedMs as number) >= 6000, `lastedMs ${String(ended.lastedMs)}`);
});

test("a reader slow to tap play (-1, clock still) logs nothing", () => {
  const p = openPage("?v=dQw4w9WgXcQ&play=0");
  p.run(10_000, 0);
  p.yt.state = 3;
  p.run(500, 0);
  p.yt.state = 1;
  p.run(5000, 1);
  assert.ok(!p.logs().includes("ad seen"));
  assert.ok(!p.logs().includes("ad ended"));
});

test("a jump to the start second while -1 is not mistaken for an ad", () => {
  const p = openPage("?v=dQw4w9WgXcQ&t=31");
  p.run(1000, 0);
  p.yt.time = 31; // cued at the start second
  p.run(3000, 0);
  assert.ok(!p.logs().includes("ad seen"));
});
