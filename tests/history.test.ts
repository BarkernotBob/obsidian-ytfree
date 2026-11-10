import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addWatchTime,
  clearHistory,
  emptyHistory,
  formatWatchTime,
  historyMatches,
  historyOrder,
  historyStats,
  importStamps,
  mergeHistory,
  normalizeHistory,
  passesFloor,
  playedSpanMs,
  recordPlay,
  removeFromHistory,
  statsLine,
} from "../src/history.ts";
import type { HistoryState } from "../src/history.ts";
import { historyOnlyItem, visibleItems } from "../src/subscriptions.ts";

const ID = "dQw4w9WgXcQ";
const OTHER = "aBcDeFgHiJk";
const T0 = new Date("2026-11-09T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const META = { title: "Never Gonna", channel: "Rick Astley", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" };

/** A video watched past the floor at `minutes`, with `seconds` of watch time on `device`. */
function watched(state: HistoryState, videoId: string, minutes: number, device = "mac", seconds = 0) {
  recordPlay(state, videoId, 300, 600, META, at(minutes), true);
  addWatchTime(state, videoId, device, seconds);
}

// ------------------------------------------------------------------ floor

test("a video counts once 2 minutes or a tenth of it has played, whichever is first", () => {
  // 5-minute clip: a tenth is 30 seconds.
  assert.equal(passesFloor(29, 300), false);
  assert.equal(passesFloor(30, 300), true);
  // 40-minute lecture: 2 minutes.
  assert.equal(passesFloor(119, 2400), false);
  assert.equal(passesFloor(120, 2400), true);
  // Unknown length never counts.
  assert.equal(passesFloor(500, Number.NaN), false);
});

test("a glance does not enter history; passing the floor does", () => {
  const state = emptyHistory();
  assert.equal(recordPlay(state, ID, 20, 300, META, T0, true), false);
  assert.deepEqual(state.entries, {});
  assert.equal(recordPlay(state, ID, 31, 300, META, T0, true), true);
  assert.equal(state.entries[ID].title, "Never Gonna");
  assert.equal(state.entries[ID].channel, "Rick Astley");
  assert.equal(state.entries[ID].playedAt, T0.toISOString());
});

test("once in history, any later report moves last watched, even from the start", () => {
  const state = emptyHistory();
  recordPlay(state, ID, 200, 600, META, T0, true);
  assert.equal(recordPlay(state, ID, 3, 600, {}, at(60), true), true);
  assert.equal(state.entries[ID].lastAt, at(60).toISOString());
  assert.equal(state.entries[ID].firstAt, T0.toISOString());
  // A report with no words keeps the words it had.
  assert.equal(state.entries[ID].title, "Never Gonna");
});

test("Preview counts for history but does not move the stamp the note tidy reads", () => {
  const state = emptyHistory();
  recordPlay(state, ID, 200, 600, META, T0, true);
  recordPlay(state, ID, 300, 600, META, at(30), false);
  assert.equal(state.entries[ID].lastAt, at(30).toISOString());
  assert.equal(state.entries[ID].playedAt, T0.toISOString());

  const previewOnly = emptyHistory();
  recordPlay(previewOnly, OTHER, 200, 600, META, T0, false);
  assert.equal(previewOnly.entries[OTHER].playedAt, undefined);
});

// ------------------------------------------------------------------ watch time

test("watch time is real playing time: 2× counts half, a suspended phone counts nothing", () => {
  assert.equal(playedSpanMs(5000, 5, 1), 5000);
  // 10 s of video at 2× took 5 s of your life.
  assert.equal(playedSpanMs(5000, 10, 2), 5000);
  // Clock moved 60 s, the video moved 1 s (app suspended): about 1 s.
  assert.equal(playedSpanMs(60_000, 1, 1), 1100);
  // A seek backwards or nothing played.
  assert.equal(playedSpanMs(5000, -30, 1), 0);
  assert.equal(playedSpanMs(0, 5, 1), 0);
});

test("each device only adds to its own counter, and the total is the sum", () => {
  const state = emptyHistory();
  watched(state, ID, 0, "mac", 60);
  addWatchTime(state, ID, "phone", 90);
  addWatchTime(state, ID, "mac", 30);
  assert.deepEqual(state.entries[ID].watch, { mac: 90, phone: 90 });
  assert.equal(historyStats(state).seconds, 180);
  // Not in history: nothing is counted.
  assert.equal(addWatchTime(state, OTHER, "mac", 10), false);
});

// ------------------------------------------------------------------ merge

test("merging two devices never double counts and never rolls a counter back", () => {
  const mac = emptyHistory();
  watched(mac, ID, 0, "mac", 600);
  // The phone has an old copy of the Mac's counter and its own.
  const phone = normalizeHistory(JSON.parse(JSON.stringify(mac)));
  phone.entries[ID].watch.mac = 100;
  addWatchTime(phone, ID, "phone", 300);

  const merged = mergeHistory(mac, phone);
  assert.deepEqual(merged.entries[ID].watch, { mac: 600, phone: 300 });
  assert.equal(historyStats(merged).seconds, 900);
  // Merging again changes nothing.
  assert.deepEqual(mergeHistory(merged, phone), merged);
  assert.deepEqual(mergeHistory(phone, mac), merged);
});

test("newest watch wins the words; first watched keeps the earliest", () => {
  const a = emptyHistory();
  recordPlay(a, ID, 300, 600, { title: "Old title", channel: "C" }, T0, true);
  const b = emptyHistory();
  recordPlay(b, ID, 300, 600, { title: "New title", channel: "" }, at(10), false);
  const merged = mergeHistory(a, b);
  assert.equal(merged.entries[ID].title, "New title");
  assert.equal(merged.entries[ID].channel, "C");
  assert.equal(merged.entries[ID].firstAt, T0.toISOString());
  assert.equal(merged.entries[ID].lastAt, at(10).toISOString());
  assert.equal(merged.entries[ID].playedAt, T0.toISOString());
});

test("a removal crosses to the other device instead of being merged back in", () => {
  const mac = emptyHistory();
  watched(mac, ID, 0);
  watched(mac, OTHER, 0);
  const phone = normalizeHistory(JSON.parse(JSON.stringify(mac)));

  removeFromHistory(mac, ID, at(5));
  const merged = mergeHistory(mac, phone);
  assert.equal(ID in merged.entries, false);
  assert.equal(OTHER in merged.entries, true);
  assert.equal(ID in mergeHistory(phone, mac).entries, false);
});

test("watching a removed video again brings it back, with fresh watch time", () => {
  const state = emptyHistory();
  watched(state, ID, 0, "mac", 500);
  const old = normalizeHistory(JSON.parse(JSON.stringify(state)));
  removeFromHistory(state, ID, at(5));
  watched(state, ID, 10, "mac", 20);
  const merged = mergeHistory(state, old);
  assert.equal(merged.entries[ID].watch.mac, 20);
  assert.equal(merged.entries[ID].lastAt, at(10).toISOString());
});

test("Clear history empties both devices and the stats; later watches still count", () => {
  const mac = emptyHistory();
  watched(mac, ID, 0, "mac", 100);
  const phone = normalizeHistory(JSON.parse(JSON.stringify(mac)));
  addWatchTime(phone, ID, "phone", 50);

  clearHistory(mac, at(5));
  assert.deepEqual(historyStats(mergeHistory(mac, phone)), { videos: 0, seconds: 0 });
  assert.deepEqual(historyStats(mergeHistory(phone, mac)), { videos: 0, seconds: 0 });

  watched(phone, OTHER, 10, "phone", 30);
  const merged = mergeHistory(mac, phone);
  assert.deepEqual(Object.keys(merged.entries), [OTHER]);
  assert.equal(historyStats(merged).seconds, 30);
});

// ------------------------------------------------------------------ file

test("whatever was on disk is made safe; bad rows are dropped", () => {
  const state = normalizeHistory({
    entries: {
      [ID]: { title: "T", channel: "C", firstAt: "x", lastAt: T0.toISOString(), watch: { mac: 12.7, bad: -1 } },
      "not-an-id": { lastAt: T0.toISOString() },
      [OTHER]: { title: "no date" },
    },
    removed: { [OTHER]: "nonsense" },
    clearedAt: 7,
  });
  assert.deepEqual(Object.keys(state.entries), [ID]);
  assert.equal(state.entries[ID].firstAt, T0.toISOString());
  assert.deepEqual(state.entries[ID].watch, { mac: 12 });
  assert.deepEqual(state.removed, {});
  assert.deepEqual(normalizeHistory(null), emptyHistory());
});

test("history is never pruned by age or size", () => {
  const state = emptyHistory();
  const long = new Date("2020-01-01T00:00:00.000Z");
  for (let i = 0; i < 3000; i++) {
    const videoId = `v${String(i).padStart(10, "0")}`;
    recordPlay(state, videoId, 300, 600, META, long, true);
  }
  const back = normalizeHistory(JSON.parse(JSON.stringify(state)));
  assert.equal(historyStats(back).videos, 3000);
});

// ------------------------------------------------------------------ migration

test("old watch stamps come in once, with no watch time and no title", () => {
  const state = emptyHistory();
  const stamps = { [ID]: T0.toISOString(), bad: T0.toISOString() };
  assert.equal(importStamps(state, stamps), true);
  assert.deepEqual(state.entries[ID], {
    title: "",
    channel: "",
    firstAt: T0.toISOString(),
    lastAt: T0.toISOString(),
    playedAt: T0.toISOString(),
    watch: {},
  });
  // Idempotent: the other device importing the same stamps changes nothing.
  assert.equal(importStamps(state, stamps), false);
});

test("an imported stamp never overwrites a newer watch, and stays out after Clear", () => {
  const state = emptyHistory();
  watched(state, ID, 60, "mac", 40);
  importStamps(state, { [ID]: T0.toISOString() });
  assert.equal(state.entries[ID].lastAt, at(60).toISOString());
  assert.equal(state.entries[ID].title, "Never Gonna");
  assert.equal(state.entries[ID].watch.mac, 40);

  clearHistory(state, at(90));
  assert.equal(importStamps(state, { [OTHER]: at(30).toISOString() }), false);
  assert.deepEqual(state.entries, {});
});

// ------------------------------------------------------------------ list

test("the stats line", () => {
  assert.equal(statsLine({ videos: 142, seconds: 38 * 3600 + 12 * 60 + 59 }), "142 videos · 38h 12m watched");
  assert.equal(statsLine({ videos: 1, seconds: 0 }), "1 video · 0m watched");
  assert.equal(formatWatchTime(59), "0m");
});

test("search matches title and channel, any order, accents ignored", () => {
  assert.equal(historyMatches("Déjà vu explained", "Veritasium", "deja veritasium"), true);
  assert.equal(historyMatches("Déjà vu explained", "Veritasium", "VERITASIUM"), true);
  assert.equal(historyMatches("Déjà vu explained", "Veritasium", "vsauce"), false);
  assert.equal(historyMatches("anything", "", ""), true);
});

test("the History list is every video in history, newest first, searchable", () => {
  const state = emptyHistory();
  watched(state, ID, 0);
  recordPlay(state, OTHER, 300, 600, { title: "Black holes", channel: "Kurzgesagt" }, at(10), false);
  const order = historyOrder(state);
  assert.deepEqual([...order.keys()], [OTHER, ID]);

  const items = [...order.keys()].map((videoId) => historyOnlyItem(videoId, state.entries[videoId]));
  const all = visibleItems(items, { filter: "history", channelId: null, includeShorts: true, history: order });
  assert.deepEqual(
    all.map((item) => item.videoId),
    [OTHER, ID],
  );
  const found = visibleItems(items, {
    filter: "history",
    channelId: null,
    includeShorts: true,
    history: order,
    query: "kurz",
  });
  assert.deepEqual(
    found.map((item) => item.videoId),
    [OTHER],
  );
  // A hub row not in history is not on the list.
  assert.equal(
    visibleItems(items, { filter: "history", channelId: null, includeShorts: true, history: new Map() }).length,
    0,
  );
});

test("a History card with no title says Unknown video", () => {
  assert.equal(historyOnlyItem(ID, { title: "", channel: "" }).title, "Unknown video");
});

test("mergeHistory means the same whichever device runs it", async () => {
  const { canonical } = await import("../src/synced-file.ts");
  const a = emptyHistory();
  const b = emptyHistory();
  // Same stamp, different words: the tie must not go to whoever is merging.
  recordPlay(a, ID, 300, 600, { title: "Title A", channel: "C" }, T0, true);
  recordPlay(b, ID, 300, 600, { title: "Title B", channel: "C" }, T0, false);
  addWatchTime(a, ID, "mac", 40);
  addWatchTime(b, ID, "phone", 70);
  addWatchTime(b, ID, "mac", 10);
  watched(a, OTHER, 5, "mac", 5);
  removeFromHistory(b, OTHER, at(6));
  const third = emptyHistory();
  watched(third, "zzzzzzzzzzz", 1, "ipad", 9);
  clearHistory(third, at(0.5));
  for (const [x, y] of [
    [a, b],
    [a, third],
    [b, third],
    [mergeHistory(a, b), third],
  ]) {
    assert.equal(
      canonical(mergeHistory(structuredClone(x), structuredClone(y))),
      canonical(mergeHistory(structuredClone(y), structuredClone(x))),
    );
  }
});
