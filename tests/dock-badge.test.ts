import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anyAudible,
  BADGE_TEXT,
  DockAudioBadge,
  SWEEP_MS,
} from "../src/desktop/dock-badge.ts";
import type { AudibleSource, DockLike } from "../src/desktop/dock-badge.ts";

/** A `WebContents` stand-in. `dead` throws, the way a destroyed remote proxy does. */
function source(audible: boolean, opts: { destroyed?: boolean; dead?: boolean } = {}): AudibleSource {
  return {
    isDestroyed: () => {
      if (opts.dead) throw new Error("Object has been destroyed");
      return opts.destroyed ?? false;
    },
    isCurrentlyAudible: () => {
      if (opts.dead) throw new Error("Object has been destroyed");
      return audible;
    },
  };
}

function fakeDock(): DockLike & { writes: string[]; fail?: boolean } {
  const dock = {
    writes: [] as string[],
    fail: false,
    setBadge(text: string) {
      if (dock.fail) throw new Error("dock is unavailable");
      dock.writes.push(text);
    },
  };
  return dock;
}

test("anyAudible: nothing playing", () => {
  assert.equal(anyAudible([]), false);
  assert.equal(anyAudible([source(false), source(false)]), false);
});

test("anyAudible: one window of several is enough", () => {
  assert.equal(anyAudible([source(false), source(true), source(false)]), true);
});

test("anyAudible: a destroyed WebContents is not asked", () => {
  assert.equal(anyAudible([source(true, { destroyed: true })]), false);
});

test("anyAudible: one dead proxy does not hide a live one", () => {
  // The list is a snapshot one IPC hop old; a window can close in between.
  assert.equal(anyAudible([source(false, { dead: true }), source(true)]), true);
  assert.equal(anyAudible([source(false, { dead: true })]), false);
});

test("badge appears when audio starts and clears when it stops", () => {
  const dock = fakeDock();
  let audible = false;
  const badge = new DockAudioBadge({ dock, allSources: () => [source(audible)] });

  badge.refresh();
  assert.deepEqual(dock.writes, [], "silence must not touch a badge we never set");

  audible = true;
  badge.refresh();
  assert.deepEqual(dock.writes, [BADGE_TEXT]);

  audible = false;
  badge.refresh();
  assert.deepEqual(dock.writes, [BADGE_TEXT, ""]);
});

test("the badge is rewritten on every sweep while audible", () => {
  // Not a wasteful write: it is what lets a second window's clear be undone.
  const dock = fakeDock();
  const badge = new DockAudioBadge({ dock, allSources: () => [source(true)] });

  badge.refresh();
  badge.refresh();
  badge.refresh();
  assert.deepEqual(dock.writes, [BADGE_TEXT, BADGE_TEXT, BADGE_TEXT]);
});

test("a silent instance never clears someone else's badge", () => {
  const dock = fakeDock();
  const badge = new DockAudioBadge({ dock, allSources: () => [source(false)] });

  for (let i = 0; i < 5; i++) badge.refresh();
  badge.clear();
  assert.deepEqual(dock.writes, []);
});

test("clear takes down our own badge, and only once", () => {
  const dock = fakeDock();
  const badge = new DockAudioBadge({ dock, allSources: () => [source(true)] });

  badge.refresh();
  badge.clear();
  badge.clear();
  assert.deepEqual(dock.writes, [BADGE_TEXT, ""]);
});

test("a failed write is retried on the next sweep", () => {
  const dock = fakeDock();
  const badge = new DockAudioBadge({ dock, allSources: () => [source(true)] });

  dock.fail = true;
  badge.refresh();
  assert.deepEqual(dock.writes, []);

  dock.fail = false;
  badge.refresh();
  assert.deepEqual(dock.writes, [BADGE_TEXT]);
});

test("a failed write does not later clear a badge that was never shown", () => {
  const dock = fakeDock();
  let audible = true;
  const badge = new DockAudioBadge({ dock, allSources: () => [source(audible)] });

  dock.fail = true;
  badge.refresh();
  dock.fail = false;
  audible = false;
  badge.refresh();
  assert.deepEqual(dock.writes, []);
});

test("the sweep is slow enough to be free and fast enough to be noticed", () => {
  // Every source in the sweep costs a synchronous IPC round trip.
  assert.ok(SWEEP_MS >= 1_000 && SWEEP_MS <= 3_000);
});
