/**
 * Part 3 of the request budget (GitHub #34, #36, #37): answers kept across
 * reloads, the request governor, and which device polls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InfoCache } from "../src/info-cache.ts";
import type { AnswerStore } from "../src/info-cache.ts";
import { trimPlayerAnswer, trimYtDlpInfo } from "../src/answer-trim.ts";
import {
  BACKGROUND_PER_HOUR,
  MAX_IN_FLIGHT,
  PLAYER_GAP_MS,
  RequestGovernor,
} from "../src/request-governor.ts";
import { DESKTOP_POLL_HOLD_MS, emptyState, mergeStates, normalizeState, pollIsDue } from "../src/subscriptions.ts";

function memoryStore(initial: string | null = null): AnswerStore & { value: string | null } {
  const store = {
    value: initial,
    read: () => store.value,
    write: (v: string) => {
      store.value = v;
    },
  };
  return store;
}

// ------------------------------------------------------------ #34 persistence

test("a kept answer survives into a new cache through the store", async () => {
  let now = 1000;
  const store = memoryStore();
  const first = new InfoCache<string>(() => now);
  first.attachStore(store);
  await first.get("v1", async () => "answer", () => now + 60_000);

  const second = new InfoCache<string>(() => now);
  second.attachStore(store);
  let asked = 0;
  const value = await second.get("v1", async () => {
    asked++;
    return "fresh";
  }, () => now + 60_000);
  assert.equal(value, "answer");
  assert.equal(asked, 0, "a reload sends nothing for a kept answer");
});

test("an expired stored answer is dropped on load", async () => {
  let now = 1000;
  const store = memoryStore();
  const first = new InfoCache<string>(() => now);
  first.attachStore(store);
  await first.get("v1", async () => "old", () => now + 10);

  now = 5000;
  const second = new InfoCache<string>(() => now);
  second.attachStore(store);
  assert.equal(await second.get("v1", async () => "new", () => now + 10), "new");
});

test("invalidate removes the stored copy too", async () => {
  const now = 1000;
  const store = memoryStore();
  const cache = new InfoCache<string>(() => now);
  cache.attachStore(store);
  await cache.get("v1", async () => "a", () => now + 60_000);
  cache.invalidate("v1");
  assert.deepEqual(JSON.parse(store.value!), []);
});

test("a corrupt or failing store never breaks the cache", async () => {
  const cache = new InfoCache<string>(() => 1000);
  cache.attachStore({
    read: () => "{not json",
    write: () => {
      throw new Error("quota");
    },
  });
  assert.equal(await cache.get("v1", async () => "a", () => 99_000), "a");
  assert.equal(await cache.get("v1", async () => "b", () => 99_000), "a");
});

test("the stored copy is trimmed; the in-memory one is not", async () => {
  const store = memoryStore();
  const cache = new InfoCache<{ keep: number; drop?: string }>(() => 1000);
  cache.attachStore(store, (v) => ({ keep: v.keep }));
  const value = await cache.get("v1", async () => ({ keep: 1, drop: "big" }), () => 99_000);
  assert.equal(value.drop, "big");
  assert.equal(JSON.parse(store.value!)[0][1].value.drop, undefined);
});

test("trimYtDlpInfo keeps the formats' playable fields and only json3 captions in the asked languages", () => {
  const trimmed = trimYtDlpInfo(
    {
      duration: 300,
      heatmap: [{ start_time: 0, end_time: 3, value: 1 }],
      formats: [
        { format_id: "sb0", format_note: "storyboard", url: "https://i.ytimg.com/sb" },
        { format_id: "18", url: "https://x/18", ext: "mp4", vcodec: "avc1", acodec: "mp4a", height: 360,
          // yt-dlp's per-format extras the plugin never reads:
          ...({ http_headers: { a: "b" }, fragments: [1, 2, 3] } as object) },
      ],
      subtitles: { en: [{ ext: "vtt", url: "v" }, { ext: "json3", url: "j" }], de: [{ ext: "json3", url: "d" }] },
      automatic_captions: { "en-US": [{ ext: "json3", url: "a" }], fr: [{ ext: "json3", url: "f" }] },
      ...({ thumbnails: new Array(40).fill({ url: "t" }) } as object),
    },
    ["en"],
  );
  assert.deepEqual(trimmed.formats, [
    { format_id: "18", url: "https://x/18", ext: "mp4", vcodec: "avc1", acodec: "mp4a", height: 360 },
  ]);
  assert.deepEqual(trimmed.subtitles, { en: [{ ext: "json3", url: "j" }] });
  assert.deepEqual(trimmed.automatic_captions, { "en-US": [{ ext: "json3", url: "a" }] });
  assert.equal(trimmed.duration, 300);
  assert.equal(trimmed.heatmap?.length, 1);
  assert.equal("thumbnails" in trimmed, false);
});

test("trimPlayerAnswer keeps what the player, captions, details and publish date read", () => {
  const trimmed = trimPlayerAnswer({
    responseContext: { big: true },
    playabilityStatus: { status: "OK", miniplayer: {} },
    streamingData: { expiresInSeconds: "21540", formats: [1], adaptiveFormats: [2], hlsManifestUrl: "h" },
    videoDetails: { lengthSeconds: "60", title: "t", thumbnail: { thumbnails: [] } },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
    microformat: { playerMicroformatRenderer: { publishDate: "2026-01-01" } },
    storyboards: {},
  }) as Record<string, Record<string, unknown>>;
  assert.equal(trimmed.playabilityStatus.status, "OK");
  assert.equal(trimmed.streamingData.expiresInSeconds, "21540");
  assert.deepEqual(trimmed.streamingData.adaptiveFormats, [2]);
  assert.equal(trimmed.videoDetails.lengthSeconds, "60");
  assert.equal("thumbnail" in trimmed.videoDetails, false);
  assert.ok(trimmed.captions);
  assert.ok(trimmed.microformat);
  assert.equal("storyboards" in trimmed, false);
  assert.equal("responseContext" in trimmed, false);
});

// ---------------------------------------------------------------- #36 governor

/** A clock the governor's sleeps advance, so pacing is checked without waiting. */
function fakeClock() {
  const clock = { now: 0, slept: [] as number[] };
  return {
    clock,
    now: () => clock.now,
    sleep: async (ms: number) => {
      clock.slept.push(ms);
      clock.now += ms;
    },
  };
}

test("player calls are spaced PLAYER_GAP_MS apart", async () => {
  const { clock, now, sleep } = fakeClock();
  const g = new RequestGovernor(now, sleep);
  const at: number[] = [];
  for (let i = 0; i < 3; i++) await g.run("player", async () => at.push(clock.now));
  assert.deepEqual(at, [0, PLAYER_GAP_MS, 2 * PLAYER_GAP_MS]);
  assert.equal(g.counts.player, 3);
});

test("no more than MAX_IN_FLIGHT paced requests at once", async () => {
  const { now, sleep } = fakeClock();
  const g = new RequestGovernor(now, sleep);
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const jobs = Array.from({ length: 5 }, () =>
    g.run("yt-dlp", () => {
      running++;
      peak = Math.max(peak, running);
      return new Promise<void>((resolve) => releases.push(() => {
        running--;
        resolve();
      }));
    }),
  );
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
    releases.shift()?.();
  }
  await Promise.all(jobs);
  assert.equal(peak, MAX_IN_FLIGHT);
  assert.equal(g.counts["yt-dlp"], 5);
});

test("a failed request frees its slot", async () => {
  const { now, sleep } = fakeClock();
  const g = new RequestGovernor(now, sleep);
  for (let i = 0; i < MAX_IN_FLIGHT + 1; i++) {
    await assert.rejects(g.run("innertube", async () => {
      throw new Error("boom");
    }));
  }
  assert.equal(await g.run("innertube", async () => "ok"), "ok");
});

test("background work stops at the hourly cap and resumes an hour later", () => {
  const { clock, now, sleep } = fakeClock();
  const g = new RequestGovernor(now, sleep);
  for (let i = 0; i < BACKGROUND_PER_HOUR - 1; i++) g.count("probe");
  assert.equal(g.backgroundRoom(), true);
  g.count("captions");
  assert.equal(g.backgroundRoom(), false);
  clock.now += 3600_001;
  assert.equal(g.backgroundRoom(), true);
});

test("feeds and byte reads are counted but never use up the background cap", () => {
  const { now, sleep } = fakeClock();
  const g = new RequestGovernor(now, sleep);
  for (let i = 0; i < 500; i++) {
    g.count("feed");
    g.count("range");
  }
  assert.equal(g.backgroundRoom(), true);
  assert.equal(g.counts.feed, 500);
});

test("summary lists only the kinds that were sent", async () => {
  const { now, sleep } = fakeClock();
  const g = new RequestGovernor(now, sleep);
  assert.equal(g.summary(), "no requests to YouTube yet");
  await g.run("yt-dlp", async () => undefined);
  g.count("range");
  g.count("range");
  assert.equal(g.summary(), "1 yt-dlp runs, 2 video byte reads");
});

// ------------------------------------------------------------- #37 who polls

const HOUR = 3600_000;
const at = (ms: number) => new Date(ms).toISOString();

test("nothing polls before the poll period has passed", () => {
  const state = { lastPolledAt: at(10 * HOUR), lastPolledBy: "phone" as const };
  assert.equal(pollIsDue(state, 10 * HOUR + 10 * 60_000, 30 * 60_000, true), false);
  assert.equal(pollIsDue(state, 10 * HOUR + 31 * 60_000, 30 * 60_000, true), true);
});

test("the phone leaves polling to a desktop that polled in the last two hours", () => {
  const state = { lastPolledAt: at(10 * HOUR), lastPolledBy: "desktop" as const };
  const later = 10 * HOUR + HOUR;
  assert.equal(pollIsDue(state, later, 30 * 60_000, false), false);
  assert.equal(pollIsDue(state, later, 30 * 60_000, true), true);
  assert.equal(pollIsDue(state, 10 * HOUR + DESKTOP_POLL_HOLD_MS + 1, 30 * 60_000, false), true);
});

test("a device that has never polled polls", () => {
  assert.equal(pollIsDue({ lastPolledAt: null }, 0, 30 * 60_000, false), true);
});

test("a merge keeps the later poll and the device that made it", () => {
  const mine = { ...emptyState(), lastPolledAt: at(1 * HOUR), lastPolledBy: "phone" as const };
  const theirs = { ...emptyState(), lastPolledAt: at(2 * HOUR), lastPolledBy: "desktop" as const };
  const merged = mergeStates(mine, theirs);
  assert.equal(merged.lastPolledAt, at(2 * HOUR));
  assert.equal(merged.lastPolledBy, "desktop");
  assert.equal(mergeStates(theirs, mine).lastPolledBy, "desktop");
});

test("lastPolledBy is read back from disk, and anything else is ignored", () => {
  assert.equal(normalizeState({ lastPolledBy: "desktop" }).lastPolledBy, "desktop");
  assert.equal(normalizeState({ lastPolledBy: "toaster" }).lastPolledBy, undefined);
});
