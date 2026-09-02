/**
 * Regression suite for the bug that lost hidden videos.
 *
 * `subscriptions.json` is one JSON blob, synced by iCloud, held in memory by
 * every device that has Obsidian open. Before `mergeStates` a save wrote that
 * memory over the whole file, so the last device to save won everything: videos
 * hidden on the phone came back the moment the Mac's poll saved a snapshot
 * taken before the phone touched it.
 *
 * These tests are the guarantee that it does not happen again. Anything that
 * changes how state is written should have to break a test here first — so the
 * cases are written as scenarios ("the Mac polls with a stale copy") rather
 * than as unit assertions about fields.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HubItem, SubscriptionsState } from "../src/subscriptions.ts";
import {
  applyUnsubscribes,
  emptyState,
  forgetVideo,
  hideItem,
  mergeItems,
  rememberVideo,
  keepItem,
  mergeStates,
  normalizeState,
  restoreItem,
} from "../src/subscriptions.ts";

const CHANNEL = "UC6107grRI4m0o2-emgoDnAA";

function item(videoId: string, over: Partial<HubItem> = {}): HubItem {
  return {
    videoId,
    channelId: CHANNEL,
    channelTitle: "A channel",
    title: `Video ${videoId}`,
    published: "2026-07-01T00:00:00.000Z",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    description: "words",
    views: 100,
    isShort: false,
    state: "new",
    seenAt: "2026-07-01T00:00:00.000Z",
    origin: "feed",
    ...over,
  };
}

function state(items: HubItem[], over: Partial<SubscriptionsState> = {}): SubscriptionsState {
  return {
    ...emptyState(),
    channels: [{ id: CHANNEL, title: "A channel", addedAt: "2026-06-01T00:00:00.000Z", error: null }],
    items,
    ...over,
  };
}

/** A deep copy, because a device's memory is not the other device's memory. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const find = (merged: SubscriptionsState, videoId: string): HubItem =>
  merged.items.find((i) => i.videoId === videoId)!;

// ------------------------------------------------------- the reported bug

test("the Mac's stale poll cannot un-hide what the phone just hid", () => {
  // Both devices start from the same file.
  const shared = state(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id) => item(id)));
  const mac = copy(shared);
  const phone = copy(shared);

  // The phone hides all three. The Mac never hears about it — its Obsidian has
  // been open since this morning.
  for (const it of phone.items) hideItem(it, new Date("2026-07-29T12:00:00Z"));

  // The Mac now polls and saves. `save()` merges into what is on disk, which is
  // the phone's file.
  const written = mergeStates(mac, phone);

  assert.equal(written.items.filter((i) => i.state === "dismissed").length, 3);
  assert.ok(
    written.items.every((i) => i.state === "dismissed"),
    "a hide made on the other device must survive this device's save",
  );
});

test("and the phone does not un-hide what the Mac hid, either — it is symmetric", () => {
  const shared = state([item("aaaaaaaaaaa")]);
  const mac = copy(shared);
  const phone = copy(shared);
  hideItem(mac.items[0], new Date("2026-07-29T12:00:00Z"));

  assert.equal(find(mergeStates(phone, mac), "aaaaaaaaaaa").state, "dismissed");
  assert.equal(find(mergeStates(mac, phone), "aaaaaaaaaaa").state, "dismissed");
});

test("a hide survives any number of merges with a device that never learned of it", () => {
  const phone = state([item("aaaaaaaaaaa")]);
  hideItem(phone.items[0], new Date("2026-07-29T12:00:00Z"));
  const stale = state([item("aaaaaaaaaaa")]);

  let disk = copy(phone);
  for (let i = 0; i < 5; i++) disk = mergeStates(copy(stale), disk);
  assert.equal(find(disk, "aaaaaaaaaaa").state, "dismissed");
});

// ------------------------------------------------------ decisions vs facts

test("the newer decision wins: putting a video back beats an older removal", () => {
  const hidden = state([item("aaaaaaaaaaa")]);
  hideItem(hidden.items[0], new Date("2026-07-29T10:00:00Z"));

  const restored = copy(hidden);
  restoreItem(restored.items[0], new Date("2026-07-29T11:00:00Z"));

  assert.equal(find(mergeStates(hidden, restored), "aaaaaaaaaaa").state, "new");
  assert.equal(find(mergeStates(restored, hidden), "aaaaaaaaaaa").state, "new");
});

test("and an older restore does not beat a newer removal", () => {
  const restored = state([item("aaaaaaaaaaa")]);
  restoreItem(restored.items[0], new Date("2026-07-29T10:00:00Z"));

  const hidden = copy(restored);
  hideItem(hidden.items[0], new Date("2026-07-29T11:00:00Z"));

  assert.equal(find(mergeStates(restored, hidden), "aaaaaaaaaaa").state, "dismissed");
});

test("a tombstone written before decidedAt existed still beats an undecided copy", () => {
  // The seven such items in the real vault: state dismissed, no timestamps.
  const legacy = state([item("aaaaaaaaaaa", { state: "dismissed", description: "", thumbnail: "" })]);
  const fresh = state([item("aaaaaaaaaaa")]);

  assert.equal(find(mergeStates(fresh, legacy), "aaaaaaaaaaa").state, "dismissed");
  assert.equal(find(mergeStates(legacy, fresh), "aaaaaaaaaaa").state, "dismissed");
});

test("dismissedAt alone is enough to date a decision", () => {
  const old = state([
    item("aaaaaaaaaaa", { state: "dismissed", dismissedAt: "2026-07-01T00:00:00.000Z" }),
  ]);
  const newer = state([item("aaaaaaaaaaa")]);
  restoreItem(newer.items[0], new Date("2026-07-29T00:00:00Z"));
  assert.equal(find(mergeStates(old, newer), "aaaaaaaaaaa").state, "new");
});

test("Kept wins a tie, because a Kept item has a note behind it", () => {
  const kept = state([item("aaaaaaaaaaa", { state: "kept", notePath: "Watch Later/x.md" })]);
  const dismissed = state([item("aaaaaaaaaaa", { state: "dismissed" })]);
  const merged = find(mergeStates(dismissed, kept), "aaaaaaaaaaa");
  assert.equal(merged.state, "kept");
  assert.equal(merged.notePath, "Watch Later/x.md");
});

test("opening a video on one device marks it Kept on the other", () => {
  const phone = state([item("aaaaaaaaaaa")]);
  const mac = copy(phone);
  keepItem(mac.items[0], "Watch Later/x.md", new Date("2026-07-29T12:00:00Z"));

  const merged = find(mergeStates(phone, mac), "aaaaaaaaaaa");
  assert.equal(merged.state, "kept");
  assert.equal(merged.notePath, "Watch Later/x.md");
});

test("facts are pooled even when the decision comes from one side", () => {
  // The Mac's poll backfilled a duration and a Shorts probe; the phone hid it
  // later. Both are true, and the merge should not have to choose.
  const mac = state([item("aaaaaaaaaaa", { durationSeconds: 640, isShort: false })]);
  const phone = state([item("aaaaaaaaaaa", { durationSeconds: undefined, isShort: null })]);
  hideItem(phone.items[0], new Date("2026-07-29T12:00:00Z"));

  const merged = find(mergeStates(mac, phone), "aaaaaaaaaaa");
  assert.equal(merged.state, "dismissed");
  assert.equal(merged.durationSeconds, 640);
  assert.equal(merged.isShort, false);
});

test("a merge never hands a description back to a tombstone", () => {
  // hideItem drops the description on purpose — the hidden list is the one list
  // that only grows. A merge that restored it would undo that on every save.
  const mac = state([item("aaaaaaaaaaa", { description: "a few kilobytes" })]);
  const phone = copy(mac);
  hideItem(phone.items[0], new Date("2026-07-29T12:00:00Z"));

  const merged = find(mergeStates(mac, phone), "aaaaaaaaaaa");
  assert.equal(merged.description, "");
  assert.equal(merged.thumbnail, "");
});

test("the earlier sighting is kept, and a two-source item stays 'both'", () => {
  const a = state([item("aaaaaaaaaaa", { seenAt: "2026-07-05T00:00:00.000Z", origin: "feed" })]);
  const b = state([
    item("aaaaaaaaaaa", { seenAt: "2026-07-01T00:00:00.000Z", origin: "watchlater" }),
  ]);
  const merged = find(mergeStates(a, b), "aaaaaaaaaaa");
  assert.equal(merged.seenAt, "2026-07-01T00:00:00.000Z");
  assert.equal(merged.origin, "both");
});

// ------------------------------------------------------------ what is there

test("an item only one device has ever seen is not dropped", () => {
  const mac = state([item("aaaaaaaaaaa")]);
  const phone = state([item("bbbbbbbbbbb")]);
  const merged = mergeStates(mac, phone);
  assert.deepEqual(merged.items.map((i) => i.videoId).sort(), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
});

test("merging a file against itself changes nothing", () => {
  const one = state([item("aaaaaaaaaaa"), item("bbbbbbbbbbb", { state: "dismissed" })]);
  assert.deepEqual(mergeStates(copy(one), copy(one)), one);
});

test("the newest poll time wins, and no poll at all is tolerated", () => {
  const a = state([], { lastPolledAt: "2026-07-29T10:00:00.000Z" });
  const b = state([], { lastPolledAt: "2026-07-29T11:00:00.000Z" });
  assert.equal(mergeStates(a, b).lastPolledAt, "2026-07-29T11:00:00.000Z");
  assert.equal(mergeStates(state([]), state([])).lastPolledAt, null);
});

// ---------------------------------------------------------------- channels

test("a channel added on one device arrives on the other", () => {
  const other = "UCXuqSBlHAE6Xw-yeJA0Tunw";
  const mac = state([]);
  const phone = state([], {
    channels: [
      ...state([]).channels,
      { id: other, title: "Another", addedAt: "2026-07-29T00:00:00.000Z", error: null },
    ],
  });
  assert.equal(mergeStates(mac, phone).channels.length, 2);
});

test("a channel removed on one device stays removed after a merge", () => {
  const phone = state([item("aaaaaaaaaaa")], {
    channels: [],
    items: [],
    removedChannels: [{ id: CHANNEL, at: "2026-07-29T12:00:00.000Z" }],
  });
  const mac = state([item("aaaaaaaaaaa")]);

  const merged = mergeStates(mac, phone);
  assert.deepEqual(merged.channels, [], "the channel came back");
  assert.deepEqual(merged.items, [], "its videos came back with it");
});

test("removing a channel does not take a note you already made with it", () => {
  const kept = item("aaaaaaaaaaa", { state: "kept", notePath: "Watch Later/x.md" });
  const phone = state([], {
    channels: [],
    items: [],
    removedChannels: [{ id: CHANNEL, at: "2026-07-29T12:00:00.000Z" }],
  });
  const merged = mergeStates(state([kept]), phone);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].state, "kept");
});

test("adding a channel back after removing it sticks", () => {
  const mac = state([], {
    channels: [{ id: CHANNEL, title: "A channel", addedAt: "2026-07-29T13:00:00.000Z", error: null }],
  });
  const phone = state([], {
    channels: [],
    removedChannels: [{ id: CHANNEL, at: "2026-07-29T12:00:00.000Z" }],
  });
  assert.equal(mergeStates(mac, phone).channels.length, 1);
});

// ------------------------------------------------------------- round trip

test("a decision survives the trip through JSON and normalizeState", () => {
  const phone = state([item("aaaaaaaaaaa")], {
    removedChannels: [{ id: "UCXuqSBlHAE6Xw-yeJA0Tunw", at: "2026-07-29T12:00:00.000Z" }],
  });
  hideItem(phone.items[0], new Date("2026-07-29T12:00:00Z"));

  const reread = normalizeState(JSON.parse(JSON.stringify(phone)));
  assert.equal(reread.items[0].decidedAt, "2026-07-29T12:00:00.000Z");
  assert.equal(reread.removedChannels?.length, 1);

  // And the reread copy still wins against a device that never saw the hide.
  assert.equal(find(mergeStates(state([item("aaaaaaaaaaa")]), reread), "aaaaaaaaaaa").state,
    "dismissed");
});

// --------------------------------------------------- deleting a video note

test("deleting a note takes the video out of every list", () => {
  const mac = state([item("aaaaaaaaaaa", { state: "kept", notePath: "Watch Later/a.md" })]);
  forgetVideo(mac, "aaaaaaaaaaa", new Date("2026-07-31T12:00:00Z"));

  assert.deepEqual(mac.items, []);
  assert.deepEqual(mac.deletedVideos, [{ id: "aaaaaaaaaaa", at: "2026-07-31T12:00:00.000Z" }]);
});

test("a deleted video is not handed back by a device that has not merged yet", () => {
  // The exact shape of the hidden-videos bug, one level along: the phone still
  // holds the Kept item, and Kept outranks every other state in `mergeItem`.
  const phone = state([item("aaaaaaaaaaa", { state: "kept", notePath: "Watch Later/a.md" })]);
  const mac = copy(phone);
  forgetVideo(mac, "aaaaaaaaaaa", new Date("2026-07-31T12:00:00Z"));

  assert.deepEqual(mergeStates(mac, phone).items, []);
  assert.deepEqual(mergeStates(phone, mac).items, []);
});

test("a deleted video is not re-added by the next poll of its channel", () => {
  const mac = state([item("aaaaaaaaaaa")]);
  forgetVideo(mac, "aaaaaaaaaaa", new Date("2026-07-31T12:00:00Z"));

  const entry = {
    videoId: "aaaaaaaaaaa",
    title: "Video aaaaaaaaaaa",
    published: "2026-07-30T00:00:00.000Z",
    thumbnail: "",
    description: "words",
    views: 100,
  };
  const merged = mergeItems(
    mac.items,
    mac.channels[0],
    [entry],
    new Date("2026-07-31T13:00:00Z"),
    mac.deletedVideos ?? [],
  );
  assert.deepEqual(merged.added, []);
});

test("a deleted video can still be added back from search, and stays back", () => {
  const mac = state([item("aaaaaaaaaaa")]);
  forgetVideo(mac, "aaaaaaaaaaa", new Date("2026-07-31T12:00:00Z"));

  // What `addSearchResult` does: clear the tombstone, then push a stamped item.
  rememberVideo(mac, "aaaaaaaaaaa");
  mac.items.push(item("aaaaaaaaaaa", {
    origin: "search",
    decidedAt: "2026-07-31T14:00:00.000Z",
  }));

  // The other device still holds the tombstone and nothing else.
  const phone = state([], { deletedVideos: [{ id: "aaaaaaaaaaa", at: "2026-07-31T12:00:00.000Z" }] });
  const merged = mergeStates(mac, phone);
  assert.equal(merged.items.length, 1);
  // And the losing tombstone is dropped, so it cannot win a later merge.
  assert.deepEqual(merged.deletedVideos, []);
});

test("deleting a note the hub never knew about is not a decision about anything", () => {
  const mac = state([item("aaaaaaaaaaa")]);
  forgetVideo(mac, "bbbbbbbbbbb", new Date("2026-07-31T12:00:00Z"));
  assert.equal(mac.items.length, 1);
});

test("deletions survive the trip through JSON", () => {
  const mac = state([item("aaaaaaaaaaa")]);
  forgetVideo(mac, "aaaaaaaaaaa", new Date("2026-07-31T12:00:00Z"));
  const reread = normalizeState(JSON.parse(JSON.stringify(mac)));
  assert.deepEqual(reread.deletedVideos, [{ id: "aaaaaaaaaaa", at: "2026-07-31T12:00:00.000Z" }]);
});

// ------------------------------------------------ unsubscribed on YouTube (044)

const OTHER = "UCsXVk37bltHxD1rDPwtNM8Q";

test("an unsubscribe drops the channel and touches not one video", () => {
  // BarkernotBob's decision, in his words: "Channel leaves so no new videos come, but
  // nothing gets purged from what's already in the hub."
  const before = state([
    item("aaaaaaaaaaa"),
    item("bbbbbbbbbbb", { state: "kept", notePath: "Videos/b.md" }),
    item("ccccccccccc", { state: "dismissed", dismissedAt: "2026-07-02T00:00:00.000Z" }),
  ]);

  const result = applyUnsubscribes(
    before.channels,
    before.unsubscribedChannels,
    [OTHER],
    new Date("2026-07-28T12:00:00Z"),
  );

  assert.deepEqual(result.channels, []);
  assert.deepEqual(result.removed.map((c) => c.id), [CHANNEL]);
  assert.deepEqual(result.unsubscribedChannels, [
    { id: CHANNEL, at: "2026-07-28T12:00:00.000Z" },
  ]);

  // The items are the caller's, and `applyUnsubscribes` never sees them. The
  // merge is where the difference from `removedChannels` has to hold.
  const after = mergeStates(
    { ...before, channels: result.channels, unsubscribedChannels: result.unsubscribedChannels },
    { ...before, channels: result.channels, unsubscribedChannels: result.unsubscribedChannels },
  );
  assert.deepEqual(after.items.map((i) => i.videoId).sort(), [
    "aaaaaaaaaaa",
    "bbbbbbbbbbb",
    "ccccccccccc",
  ]);
  assert.equal(after.items.find((i) => i.videoId === "bbbbbbbbbbb")?.notePath, "Videos/b.md");
  assert.deepEqual(after.channels, []);
});

test("removing a channel in the hub still purges what you had not kept", () => {
  // The other half of the same guarantee: the two lists mean different things,
  // and adding one must not have quietly changed the other.
  const before = state([item("aaaaaaaaaaa"), item("bbbbbbbbbbb", { state: "kept" })], {
    channels: [],
    removedChannels: [{ id: CHANNEL, at: "2026-07-28T12:00:00.000Z" }],
  });
  const after = mergeStates(before, copy(before));
  assert.deepEqual(after.items.map((i) => i.videoId), ["bbbbbbbbbbb"]);
});

test("a failed or partial channel fetch removes nothing", () => {
  // The `.catch(() => [])` in the sync used to be harmless because nothing
  // acted on absence. An empty live list must never read as "you unsubscribed
  // from everything" — and neither must the `:ytsubs` fallback, which the call
  // site refuses on its own because this function cannot tell them apart.
  const before = state([]);
  const result = applyUnsubscribes(before.channels, before.unsubscribedChannels, [], new Date());
  assert.deepEqual(result.channels, before.channels);
  assert.deepEqual(result.removed, []);
});

test("an unsubscribe crosses to a device that has not synced yet", () => {
  const mac = state([item("aaaaaaaaaaa")], {
    channels: [],
    unsubscribedChannels: [{ id: CHANNEL, at: "2026-07-28T12:00:00.000Z" }],
  });
  // The phone still lists the channel — it has not run an account sync.
  const phone = state([item("aaaaaaaaaaa")]);

  const merged = mergeStates(copy(phone), copy(mac));
  assert.deepEqual(merged.channels, []);
  assert.deepEqual(merged.items.map((i) => i.videoId), ["aaaaaaaaaaa"]);
  // And the tombstone survives, or the next merge hands the channel back.
  assert.deepEqual(merged.unsubscribedChannels, [
    { id: CHANNEL, at: "2026-07-28T12:00:00.000Z" },
  ]);
});

test("re-subscribing brings the channel back and it stays back", () => {
  const mac = state([], {
    channels: [],
    unsubscribedChannels: [{ id: CHANNEL, at: "2026-07-28T12:00:00.000Z" }],
  });
  // The next sync sees it again: `applyAccountChannels` adds it with a fresh
  // stamp and drops the tombstone it has outlived.
  const back = applyUnsubscribes(
    [{ id: CHANNEL, title: "A channel", addedAt: "2026-07-29T09:00:00.000Z", error: null }],
    mac.unsubscribedChannels,
    [CHANNEL],
    new Date("2026-07-29T09:00:00Z"),
  );
  assert.deepEqual(back.channels.map((c) => c.id), [CHANNEL]);
  assert.deepEqual(back.unsubscribedChannels, []);

  // The phone has not merged yet, so it still holds the tombstone *and* the
  // channel at its original `addedAt`. The merge must not delete it again —
  // the newest stamp either device holds is what the tombstone answers to.
  const phone = state([], { unsubscribedChannels: mac.unsubscribedChannels });
  const merged = mergeStates(
    { ...mac, channels: back.channels, unsubscribedChannels: back.unsubscribedChannels },
    copy(phone),
  );
  assert.deepEqual(merged.channels.map((c) => c.id), [CHANNEL]);
});

test("unsubscribes survive the trip through JSON", () => {
  const raw = JSON.parse(
    JSON.stringify(
      state([], { unsubscribedChannels: [{ id: CHANNEL, at: "2026-07-28T12:00:00.000Z" }] }),
    ),
  ) as unknown;
  assert.deepEqual(normalizeState(raw).unsubscribedChannels, [
    { id: CHANNEL, at: "2026-07-28T12:00:00.000Z" },
  ]);
  // And a file written before this list existed still loads.
  assert.deepEqual(normalizeState({ version: 1, channels: [], items: [] }).unsubscribedChannels, []);
});
