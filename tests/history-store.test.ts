import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";

// The store schedules writes on `window`; node has none.
(globalThis as { window?: unknown }).window ??= globalThis;

const { HistoryStore } = await import("../src/history-store.ts");

const ID = "dQw4w9WgXcQ";
const OTHER = "aBcDeFgHiJk";
const PATH = "plugins/ytfree/history.json";

/** A vault adapter over one map, with a switch that makes reads fail like a half-synced iCloud file. */
function fakeApp() {
  const files = new Map<string, string>();
  let mtime = 1;
  const disk = {
    files,
    unreadable: false,
    writes: 0,
  };
  const adapter = {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => {
      if (disk.unreadable) throw new Error("placeholder");
      return files.get(path) ?? "";
    },
    write: async (path: string, data: string) => {
      disk.writes += 1;
      mtime += 1;
      files.set(path, data);
    },
    stat: async (path: string) => (files.has(path) ? { mtime } : null),
  };
  return { app: { vault: { adapter } } as unknown as App, disk };
}

function onDisk(disk: { files: Map<string, string> }) {
  return JSON.parse(disk.files.get(PATH) ?? "{}");
}

test("a file that exists but cannot be read is never written over", async () => {
  const { app, disk } = fakeApp();
  disk.files.set(PATH, JSON.stringify({ entries: { [OTHER]: { title: "Precious", lastAt: "2025-01-01T00:00:00.000Z", watch: {} } }, removed: {} }));
  const store = new HistoryStore(app, PATH, "mac");
  disk.unreadable = true;
  await store.load();
  store.record(ID, 300, 600, { title: "New" }, true);
  await store.flush();
  assert.equal(disk.writes, 0);
  assert.equal(onDisk(disk).entries[OTHER].title, "Precious");

  // Once it can be read, the change goes out merged with what was there.
  disk.unreadable = false;
  await store.flush();
  assert.equal(disk.writes, 1);
  assert.deepEqual(Object.keys(onDisk(disk).entries).sort(), [ID, OTHER].sort());
});

test("old stamps are confirmed only once history is on disk with them", async () => {
  const { app, disk } = fakeApp();
  const store = new HistoryStore(app, PATH, "mac");
  await store.load();

  disk.files.set(PATH, "{ half a file");
  disk.unreadable = true;
  assert.equal(await store.importStamps({ [ID]: "2026-01-01T00:00:00.000Z" }), false);

  disk.unreadable = false;
  disk.files.delete(PATH);
  assert.equal(await store.importStamps({ [ID]: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(onDisk(disk).entries[ID].lastAt, "2026-01-01T00:00:00.000Z");
});

test("time played before the floor counts once the video enters history", async () => {
  const { app } = fakeApp();
  const store = new HistoryStore(app, PATH, "mac");
  await store.load();
  store.addWatch(ID, 25);
  store.record(ID, 25, 300, {}, true);
  assert.equal(store.stats().videos, 0);
  store.addWatch(ID, 10);
  store.record(ID, 35, 300, {}, true);
  assert.deepEqual(store.stats(), { videos: 1, seconds: 35 });
  await store.flush();
});

test("a removal on one device reaches the other through the file", async () => {
  const { app } = fakeApp();
  const mac = new HistoryStore(app, PATH, "mac");
  const phone = new HistoryStore(app, PATH, "phone");
  await mac.load();
  await phone.load();
  mac.record(ID, 300, 600, { title: "A" }, true);
  mac.record(OTHER, 300, 600, { title: "B" }, true);
  await mac.flush();
  await phone.refreshFromDisk();
  assert.equal(phone.stats().videos, 2);

  await mac.remove(ID);
  await phone.refreshFromDisk();
  assert.deepEqual([...phone.order().keys()], [OTHER]);
  // And the phone's next save does not bring it back.
  phone.addWatch(OTHER, 5);
  await phone.flush();
  await mac.refreshFromDisk();
  assert.deepEqual([...mac.order().keys()], [OTHER]);
});

test("a file that lost this device's watch is written back", async () => {
  const { app, disk } = fakeApp();
  const mac = new HistoryStore(app, PATH, "mac");
  await mac.load();
  mac.record(ID, 300, 600, { title: "A" }, true);
  await mac.flush();
  // iCloud kept the other device's whole copy, which never had this video.
  await app.vault.adapter.write(PATH, JSON.stringify({ entries: {}, removed: {} }));
  const before = disk.writes;
  await mac.refreshFromDisk();
  await mac.flush();
  assert.equal(disk.writes, before + 1);
  assert.ok(ID in onDisk(disk).entries);
});
