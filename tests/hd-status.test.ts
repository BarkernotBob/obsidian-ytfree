/**
 * The quality badge's words and the "Start in HD" helpers (`hd-status.ts`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeText, bufferedAhead, rungPhase, within } from "../src/hd-status.ts";

test("badge: finding HD shows what plays meanwhile, 360p when unknown", () => {
  assert.equal(badgeText({ phase: "finding" }).text, "360p · finding HD…");
  assert.equal(badgeText({ phase: "finding", height: 480 }).text, "480p · finding HD…");
  assert.equal(badgeText({ phase: "finding" }).settled, false);
});

test("badge: climbing names the rung playing and is not settled", () => {
  const b = badgeText({ phase: "climbing", height: 480, top: 1080 });
  assert.equal(b.text, "480p · HD loading");
  assert.match(b.title, /1080p/);
  assert.equal(b.settled, false);
});

test("badge: the top rung is just its height, and settled", () => {
  assert.deepEqual(
    [badgeText({ phase: "top", height: 720, top: 720 }).text, badgeText({ phase: "top", height: 720 }).settled],
    ["720p", true],
  );
});

test("badge: no HD carries the reason in the hover text", () => {
  const b = badgeText({ phase: "none", height: 360, reason: "android: no answer" });
  assert.equal(b.text, "360p");
  assert.match(b.title, /android: no answer/);
  assert.equal(b.settled, true);
});

test("badge: HD off says where the setting is", () => {
  assert.match(badgeText({ phase: "off" }).title, /Settings/);
});

test("rungPhase: below the top is climbing, at or above is top", () => {
  assert.equal(rungPhase(480, 1080), "climbing");
  assert.equal(rungPhase(1080, 1080), "top");
});

const ranges = (...pairs: [number, number][]) => ({
  length: pairs.length,
  start: (i: number) => pairs[i]![0],
  end: (i: number) => pairs[i]![1],
});

test("bufferedAhead: the end of the range the playhead is in", () => {
  assert.equal(bufferedAhead(ranges([0, 30], [100, 140]), 12), 30);
  assert.equal(bufferedAhead(ranges([0, 30], [100, 140]), 110), 140);
});

test("bufferedAhead: just before a range after a seek counts as in it", () => {
  assert.equal(bufferedAhead(ranges([100, 140]), 99.9), 140);
});

test("bufferedAhead: nothing loaded here is the playhead itself", () => {
  assert.equal(bufferedAhead(ranges([0, 30]), 60), 60);
  assert.equal(bufferedAhead(ranges(), 5), 5);
});

test("within: a value in time, null on timeout, null on rejection", async () => {
  assert.equal(await within(Promise.resolve(7), 50), 7);
  assert.equal(await within(new Promise(() => undefined), 10), null);
  assert.equal(await within(Promise.reject(new Error("no")), 50), null);
});
