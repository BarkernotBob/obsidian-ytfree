/**
 * `ProgressStore` against an in-memory vault: the hand-over of old watch stamps
 * to history (GitHub #48) on top of the synced file (docs/V1-SCOPE-SYNC.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import { ProgressStore } from "../src/progress-store.ts";
import { emptyProgress, mergeProgress } from "../src/progress.ts";

const PATH = "plugin/progress.json";
const ID = "aaaaaaaaaaa";
const STAMP = "2026-10-01T00:00:00.000Z";

// The store's write debounce uses `window` timers.
(globalThis as { window?: unknown }).window ??= globalThis;

function vault(initial: unknown) {
  const files = new Map<string, string>([[PATH, JSON.stringify(initial)]]);
  let writes = 0;
  let tick = 1;
  const mtimes = new Map<string, number>([[PATH, tick]]);
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p)!,
    write: async (p: string, data: string) => {
      writes += 1;
      files.set(p, data);
      mtimes.set(p, ++tick);
    },
    stat: async (p: string) => (files.has(p) ? { mtime: mtimes.get(p)!, size: files.get(p)!.length } : null),
    list: async () => ({ files: [...files.keys()] }),
    remove: async (p: string) => void files.delete(p),
  };
  return { app: { vault: { adapter } } as unknown as App, files, writes: () => writes };
}

test("a handed-over stamp leaves the file and is handed over once", async () => {
  const disk = vault({ positions: {}, watched: { [ID]: STAMP } });
  const store = new ProgressStore(disk.app, PATH);
  await store.load();
  let handed = 0;
  store.drainStampsTo(async () => {
    handed += 1;
    return true;
  });
  for (let n = 0; n < 5; n += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await store.flush();
    await store.refreshFromDisk();
  }
  const file = JSON.parse(disk.files.get(PATH)!);
  assert.equal(handed, 1);
  assert.deepEqual(file.watched, {});
  assert.equal(file.drained[ID], STAMP);
  assert.ok(disk.writes() <= 2, `settled after the hand-over, ${disk.writes()} writes`);
});

test("another device's old copy cannot bring a handed-over stamp back", () => {
  const here = emptyProgress();
  here.drained[ID] = STAMP;
  const old = emptyProgress();
  old.watched[ID] = STAMP;
  assert.deepEqual(mergeProgress(here, old).watched, {});
  assert.deepEqual(mergeProgress(old, here).watched, {});
  // A newer stamp from a device on an old build is new news, and is kept.
  old.watched[ID] = "2026-11-01T00:00:00.000Z";
  assert.equal(mergeProgress(here, old).watched[ID], "2026-11-01T00:00:00.000Z");
});
