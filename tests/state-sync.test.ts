/**
 * Regression suite for the *protocol* around the merge — issue 034.
 *
 * `tests/merge.test.ts` covers `mergeStates` itself and it has been right since
 * 014. This file covers the part 014 did not: what a device does when the file
 * it is about to merge into cannot be read. iCloud hands out unreadable copies
 * routinely — an evicted file, a partial download, a copy caught mid-replace —
 * and the old code answered `null` for that, the same answer it used for "no
 * file yet", and then wrote its own whole snapshot over the top. That write is
 * the bug: a removal made on the phone existed only in the file that was just
 * overwritten unread.
 *
 * The tests below run two devices against a fake disk that can be told to fail,
 * because that is the only way to reproduce it — the real thing needs an iCloud
 * sync to land inside the few milliseconds of a save.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HubItem, SubscriptionsState } from "../src/subscriptions.ts";
import { emptyState, hideItem, keepItem, normalizeState } from "../src/subscriptions.ts";
import type { DiskRead } from "../src/state-sync.ts";
import { listFingerprint, planRefresh, planSave } from "../src/state-sync.ts";

const CHANNEL = "UC6107grRI4m0o2-emgoDnAA";

/**
 * A real-shaped video id from a one-letter name.
 *
 * `normalizeState` drops anything that is not 11 characters, and these tests go
 * through the file — so unlike `merge.test.ts`, which never round-trips, the
 * ids here have to look like YouTube's.
 */
const vid = (name: string): string => name.padEnd(11, "0");

function item(name: string, over: Partial<HubItem> = {}): HubItem {
  const videoId = vid(name);
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

function state(items: HubItem[]): SubscriptionsState {
  return {
    ...emptyState(),
    channels: [
      { id: CHANNEL, title: "A channel", addedAt: "2026-06-01T00:00:00.000Z", error: null },
    ],
    items,
  };
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The state file in iCloud, and the ways it misbehaves.
 *
 * `failReads` is not a contrived fault: it is what the adapter does for a file
 * whose local copy is a placeholder or half-written, which is the state the
 * file is in exactly when the other device has just saved to it.
 */
class FakeDisk {
  content: string | null = null;
  mtime = 0;
  failReads = false;
  /** Every write that reached the file, for asserting one never happened. */
  writes = 0;

  read(): string {
    if (this.failReads) throw new Error("EIO: file is a placeholder");
    if (this.content === null) throw new Error("ENOENT");
    return this.content;
  }

  exists(): boolean {
    return this.content !== null;
  }

  write(content: string): void {
    this.content = content;
    this.mtime += 1000;
    this.writes += 1;
  }

  /** A device saved from somewhere this test is not modelling. */
  put(value: SubscriptionsState): void {
    this.write(JSON.stringify(value));
  }
}

/**
 * One Obsidian, holding the state in memory — the same read/save/refresh
 * protocol `SubscriptionsStore` runs, with the I/O faked and the rules imported
 * rather than restated, so a change to the real rules breaks these tests.
 */
class Device {
  state: SubscriptionsState = emptyState();
  /** mtime of the last version this device successfully read or wrote. */
  diskTime = 0;
  /** Redraws asked for, and why. */
  emitted: string[] = [];

  name: string;
  private disk: FakeDisk;

  constructor(name: string, disk: FakeDisk) {
    this.name = name;
    this.disk = disk;
  }

  private readDisk(): DiskRead {
    if (!this.disk.exists()) return { kind: "absent" };
    try {
      return { kind: "state", state: normalizeState(JSON.parse(this.disk.read())) };
    } catch {
      return { kind: "unreadable" };
    }
  }

  load(): void {
    const read = this.readDisk();
    if (read.kind === "state") this.state = read.state;
    this.diskTime = this.disk.mtime;
  }

  /** Returns whether the write happened, which is what the fix turns on. */
  save(): boolean {
    const plan = planSave(this.state, this.readDisk());
    if (!plan.write) return false;
    this.state = plan.state;
    this.disk.put(this.state);
    this.diskTime = this.disk.mtime;
    if (plan.merged) this.emitted.push("merge");
    return true;
  }

  refresh(): void {
    if (this.disk.mtime === this.diskTime) return;
    const plan = planRefresh(this.state, this.readDisk());
    // The watermark moves only for a read that answered — see `RefreshPlan.seen`.
    if (!plan.seen) return;
    this.diskTime = this.disk.mtime;
    this.state = plan.state;
    if (plan.changed) this.emitted.push("merge");
  }

  find(name: string): HubItem | undefined {
    return this.state.items.find((i) => i.videoId === vid(name));
  }
}

/** Two devices sharing one file, both loaded from it. */
function pair(initial: SubscriptionsState): { disk: FakeDisk; mac: Device; phone: Device } {
  const disk = new FakeDisk();
  disk.put(copy(initial));
  const mac = new Device("mac", disk);
  const phone = new Device("phone", disk);
  mac.load();
  phone.load();
  return { disk, mac, phone };
}

// ------------------------------------------------------- the reported bug

test("a removal on the phone survives the Mac saving a stale snapshot", () => {
  const { mac, phone } = pair(state([item("a"), item("b")]));

  hideItem(phone.find("b")!, new Date("2026-08-01T10:00:00Z"));
  phone.save();

  // The Mac has been open all day and has never seen that decision.
  assert.equal(mac.find("b")!.state, "new");
  mac.save();
  mac.refresh();

  assert.equal(mac.find("b")!.state, "dismissed", "the Mac's save resurrected the removal");
  phone.refresh();
  assert.equal(phone.find("b")!.state, "dismissed", "the removal came back on the phone");
});

test("a removal is not resurrected by a save whose read of the file failed", () => {
  const { disk, mac, phone } = pair(state([item("a"), item("b")]));

  hideItem(phone.find("b")!, new Date("2026-08-01T10:00:00Z"));
  phone.save();

  // The Mac saves while iCloud is mid-replacement of the file the phone just
  // wrote — the exact window that made removals come back.
  disk.failReads = true;
  const wrote = mac.save();
  disk.failReads = false;

  assert.equal(wrote, false, "the Mac wrote over a file it could not read");
  mac.refresh();
  assert.equal(mac.find("b")!.state, "dismissed");

  phone.refresh();
  assert.equal(phone.find("b")!.state, "dismissed", "the phone's own removal came back");
});

test("the change refused by a failed save is written by the next one", () => {
  const { disk, mac, phone } = pair(state([item("a"), item("b")]));

  hideItem(mac.find("a")!, new Date("2026-08-01T10:00:00Z"));
  disk.failReads = true;
  assert.equal(mac.save(), false);
  disk.failReads = false;

  // Nothing was lost: it is still in memory, and the next save carries it.
  assert.equal(mac.save(), true);
  phone.refresh();
  assert.equal(phone.find("a")!.state, "dismissed", "the deferred removal never reached the file");
});

test("a failed read does not mark that version of the file as seen", () => {
  const { disk, mac, phone } = pair(state([item("a"), item("b")]));

  hideItem(phone.find("b")!, new Date("2026-08-01T10:00:00Z"));
  phone.save();

  // The Mac's sync button fires while the file is unreadable. Before the fix
  // this stamped the new mtime as read, so every later refresh saw "nothing has
  // changed" and the Mac stayed wrong until something else wrote the file.
  disk.failReads = true;
  mac.refresh();
  disk.failReads = false;

  mac.refresh();
  assert.equal(mac.find("b")!.state, "dismissed", "the Mac never picked the removal up");
});

test("both devices removing different videos keeps both removals", () => {
  const { mac, phone } = pair(state([item("a"), item("b"), item("c")]));

  hideItem(mac.find("a")!, new Date("2026-08-01T10:00:00Z"));
  hideItem(phone.find("c")!, new Date("2026-08-01T10:00:05Z"));
  mac.save();
  phone.save();
  mac.refresh();

  for (const device of [mac, phone]) {
    assert.equal(device.find("a")!.state, "dismissed", `${device.name} lost a`);
    assert.equal(device.find("c")!.state, "dismissed", `${device.name} lost c`);
    assert.equal(device.find("b")!.state, "new", `${device.name} changed b`);
  }
});

test("a device that has been asleep for a week does not undo the week", () => {
  const { disk, mac, phone } = pair(state([item("a"), item("b"), item("c")]));

  // The Mac is closed. Everything below happens on the phone.
  for (const [videoId, at] of [
    ["a", "2026-08-01T10:00:00Z"],
    ["b", "2026-08-03T10:00:00Z"],
    ["c", "2026-08-05T10:00:00Z"],
  ] as const) {
    hideItem(phone.find(videoId)!, new Date(at));
    phone.save();
  }

  // The Mac wakes with its week-old snapshot and saves before it refreshes —
  // an auto-poll on launch, which is how this used to happen unattended.
  mac.save();
  mac.refresh();
  assert.equal(disk.writes > 0, true);

  for (const videoId of ["a", "b", "c"]) {
    assert.equal(mac.find(videoId)!.state, "dismissed", `${videoId} came back`);
  }
});

// --------------------------------------------------------- redraw decision

test("a removal arriving from the other device asks for a redraw", () => {
  const { mac, phone } = pair(state([item("a"), item("b")]));

  hideItem(phone.find("b")!, new Date("2026-08-01T10:00:00Z"));
  phone.save();

  mac.emitted = [];
  mac.refresh();
  assert.deepEqual(mac.emitted, ["merge"], "the Mac merged the removal without redrawing");
});

test("a refresh that changes nothing does not ask for a redraw", () => {
  const { disk, mac } = pair(state([item("a"), item("b")]));

  // Some other write touches the file without changing what any list shows.
  disk.put(copy(mac.state));
  mac.emitted = [];
  mac.refresh();
  assert.deepEqual(mac.emitted, [], "redrew the list for nothing");
});

test("the fingerprint notices the things a card is drawn from", () => {
  const base = state([item("a"), item("b", { watched: false })]);
  const before = listFingerprint(base);

  const hidden = copy(base);
  hideItem(hidden.items[1]!, new Date("2026-08-01T10:00:00Z"));
  assert.notEqual(listFingerprint(hidden), before, "a removal looked identical");

  const watched = copy(base);
  watched.items[1]!.watched = true;
  assert.notEqual(listFingerprint(watched), before, "a watched stamp looked identical");

  const kept = copy(base);
  keepItem(kept.items[1]!, "Watch Later/b.md", new Date("2026-08-01T10:00:00Z"));
  assert.notEqual(listFingerprint(kept), before, "a keep looked identical");

  // Order is not meaning: `mergeStates` appends items the other device knew.
  const reordered = copy(base);
  reordered.items.reverse();
  assert.equal(listFingerprint(reordered), before, "reordering counted as a change");
});

// ------------------------------------------------------- absent vs broken

test("a first run with no file writes, a broken file does not", () => {
  const disk = new FakeDisk();
  const mac = new Device("mac", disk);
  mac.load();
  mac.state = state([item("a")]);

  assert.equal(mac.save(), true, "refused to create the file");
  assert.equal(disk.writes, 1);

  disk.failReads = true;
  assert.equal(mac.save(), false);
  assert.equal(disk.writes, 1, "wrote over an unreadable file");
});

test("an unreadable file is never mistaken for an empty one", () => {
  const disk = new FakeDisk();
  disk.put(state([item("a", { state: "kept", notePath: "Watch Later/a.md" })]));
  disk.failReads = true;

  const plan = planSave(state([]), { kind: "unreadable" });
  assert.equal(plan.write, false);
  // The file still holds what it held.
  disk.failReads = false;
  assert.equal(JSON.parse(disk.content!).items.length, 1);
});

// --------------------------------------------------------- state on disk

test("a state file from the old version loads and saves unchanged in shape", () => {
  // Exactly what is in a vault today: no field this issue added, because it
  // added none.
  const old = {
    channels: [{ id: CHANNEL, title: "A channel", addedAt: "2026-06-01T00:00:00.000Z" }],
    items: [{ videoId: vid("a"), channelId: CHANNEL, title: "Video a", state: "kept" }],
    deletedVideos: [{ id: vid("z"), at: "2026-07-01T00:00:00.000Z" }],
  };
  const disk = new FakeDisk();
  disk.write(JSON.stringify(old));

  const mac = new Device("mac", disk);
  mac.load();
  assert.equal(mac.find("a")!.state, "kept");
  assert.equal(mac.state.deletedVideos?.length, 1);

  assert.equal(mac.save(), true);
  const written = JSON.parse(disk.content!) as SubscriptionsState;
  assert.equal(written.items.length, 1);
  assert.equal(written.items[0]!.state, "kept");
  assert.equal(written.deletedVideos?.length, 1, "a tombstone from the old file was dropped");
});
