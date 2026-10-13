import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HIDDEN_CHANNELS_LIMIT,
  REMOVED_VIDEOS_LIMIT,
  UNDO_KEEP_DAYS,
  activeBlocks,
  blockedIds,
  isResultBlocked,
  liftHides,
  mergeBlockLists,
  normalizeBlockList,
  setBlocked,
} from "../src/search-blocklist.ts";
import type { BlockEntry } from "../src/search-blocklist.ts";
import { emptyState, mergeStates, normalizeState } from "../src/subscriptions.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const CH = "UCKRmL7BMyCeLE4KUo73RDzw";

test("a removal is recorded and is the only active entry", () => {
  const list = setBlocked([], { id: "aaaaaaaaaaa", title: "A" }, true, NOW, 10);
  assert.deepEqual(list, [{ id: "aaaaaaaaaaa", title: "A", at: NOW.toISOString() }]);
  assert.deepEqual([...blockedIds(list)], ["aaaaaaaaaaa"]);
});

test("an undo replaces the removal and stays as an entry", () => {
  let list = setBlocked([], { id: "aaaaaaaaaaa", title: "A" }, true, NOW, 10);
  list = setBlocked(list, { id: "aaaaaaaaaaa", title: "A" }, false, later(1), 10);
  assert.equal(list.length, 1);
  assert.equal(list[0].undone, true);
  assert.equal(blockedIds(list).size, 0);
});

test("the list is bounded, oldest first off the end", () => {
  let list: BlockEntry[] = [];
  for (let i = 0; i < 5; i++) {
    list = setBlocked(list, { id: `v${i}`, title: "" }, true, later(i), 3);
  }
  assert.deepEqual(
    list.map((e) => e.id),
    ["v2", "v3", "v4"],
  );
});

test("the limits are what the state file can carry", () => {
  assert.equal(REMOVED_VIDEOS_LIMIT, 500);
  assert.equal(HIDDEN_CHANNELS_LIMIT, 200);
});

test("merge: the newer decision per ID wins, so an undo crosses devices", () => {
  const mine = setBlocked([], { id: "aaaaaaaaaaa", title: "A" }, true, NOW, 10);
  const theirs = setBlocked(mine, { id: "aaaaaaaaaaa", title: "A" }, false, later(5), 10);
  assert.equal(blockedIds(mergeBlockLists(mine, theirs, 10, later(6))).size, 0);
  assert.equal(blockedIds(mergeBlockLists(theirs, mine, 10, later(6))).size, 0);
});

test("merge: a removal on either device reaches the other", () => {
  const mine = setBlocked([], { id: "aaaaaaaaaaa", title: "A" }, true, NOW, 10);
  const theirs = setBlocked([], { id: "bbbbbbbbbbb", title: "B" }, true, later(1), 10);
  assert.deepEqual([...blockedIds(mergeBlockLists(mine, theirs, 10, later(2)))].sort(), [
    "aaaaaaaaaaa",
    "bbbbbbbbbbb",
  ]);
});

test("old undos are dropped, old removals are not", () => {
  let list = setBlocked([], { id: "a", title: "" }, true, NOW, 10);
  list = setBlocked(list, { id: "b", title: "" }, true, NOW, 10);
  list = setBlocked(list, { id: "b", title: "" }, false, NOW, 10);
  const much = new Date(NOW.getTime() + (UNDO_KEEP_DAYS + 1) * 86_400_000);
  assert.deepEqual(
    mergeBlockLists(list, [], 10, much).map((e) => e.id),
    ["a"],
  );
});

test("active entries come newest first", () => {
  let list = setBlocked([], { id: "a", title: "" }, true, NOW, 10);
  list = setBlocked(list, { id: "b", title: "" }, true, later(1), 10);
  assert.deepEqual(
    activeBlocks(list).map((e) => e.id),
    ["b", "a"],
  );
});

test("a removed video is blocked in search and on a channel screen", () => {
  const removed = new Set(["aaaaaaaaaaa"]);
  const result = { videoId: "aaaaaaaaaaa", channelId: CH };
  assert.equal(isResultBlocked(result, "search", removed, new Set(), new Set()), true);
  assert.equal(isResultBlocked(result, "channel", removed, new Set(), new Set()), true);
});

test("a hidden channel filters search only", () => {
  const hidden = new Set([CH]);
  const result = { videoId: "aaaaaaaaaaa", channelId: CH };
  assert.equal(isResultBlocked(result, "search", new Set(), hidden, new Set()), true);
  assert.equal(isResultBlocked(result, "channel", new Set(), hidden, new Set()), false);
});

test("subscribing wins over a hide even before the hide is lifted", () => {
  const hidden = new Set([CH]);
  const result = { videoId: "aaaaaaaaaaa", channelId: CH };
  assert.equal(isResultBlocked(result, "search", new Set(), hidden, new Set([CH])), false);
});

test("a result with no channel is never hidden by a channel hide", () => {
  assert.equal(
    isResultBlocked({ videoId: "a", channelId: "" }, "search", new Set(), new Set([""]), new Set()),
    false,
  );
});

test("liftHides undoes only hides in force, and reports them", () => {
  const list = setBlocked([], { id: CH, title: "Ward on Words" }, true, NOW, 10);
  const { list: next, lifted } = liftHides(list, [CH, "UCother"], later(1));
  assert.deepEqual(
    lifted.map((e) => e.title),
    ["Ward on Words"],
  );
  assert.equal(blockedIds(next).size, 0);
  assert.equal(liftHides(next, [CH], later(2)).lifted.length, 0);
});

test("normalize drops junk and keeps undo flags", () => {
  const raw = [
    null,
    { id: 3, at: "x" },
    { id: "a", at: NOW.toISOString(), title: "A", undone: true },
    { id: "b", at: NOW.toISOString() },
  ];
  assert.deepEqual(normalizeBlockList(raw), [
    { id: "a", title: "A", at: NOW.toISOString(), undone: true },
    { id: "b", title: "", at: NOW.toISOString() },
  ]);
  assert.deepEqual(normalizeBlockList("nope"), []);
});

test("the state file carries both lists through normalize and merge", () => {
  const mine = {
    ...emptyState(),
    searchRemovedVideos: setBlocked([], { id: "aaaaaaaaaaa", title: "A" }, true, NOW, 10),
  };
  const theirs = {
    ...emptyState(),
    searchHiddenChannels: setBlocked([], { id: CH, title: "W" }, true, NOW, 10),
  };
  const merged = mergeStates(normalizeState(mine), normalizeState(theirs));
  assert.equal(blockedIds(merged.searchRemovedVideos).size, 1);
  assert.equal(blockedIds(merged.searchHiddenChannels).size, 1);
  // Never touches items: nothing here was ever in the hub.
  assert.deepEqual(merged.items, []);
});
