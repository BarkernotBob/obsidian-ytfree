/**
 * Feed order and per-channel check times (GitHub #66). Every poll checks every
 * channel; see `src/feed-schedule.ts` for the measurement behind that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stalestFirst } from "../src/feed-schedule.ts";
import { emptyState, isFirstSight, mergeStates } from "../src/subscriptions.ts";
import type { Channel } from "../src/subscriptions.ts";


test("every channel is checked, never-checked first, then the oldest, in list order", () => {
  const channels: Array<{ id: string; polledAt?: string }> = [];
  for (let i = 0; i < 300; i++) {
    channels.push({ id: `c${i}`, polledAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() });
  }
  channels.push({ id: "fresh-a" }, { id: "fresh-b" });
  const order = stalestFirst(channels);
  assert.equal(order.length, 302, "a 300-channel import is checked in full every poll");
  assert.deepEqual(order.slice(0, 3).map((c) => c.id), ["fresh-a", "fresh-b", "c0"]);
});

test("merging two devices keeps the later polledAt for each channel", () => {
  const channel = (polledAt?: string): Channel => ({
    id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    title: "A",
    addedAt: "2026-11-01T00:00:00.000Z",
    ...(polledAt ? { polledAt } : {}),
  });
  const mine = { ...emptyState(), channels: [channel("2026-11-08T00:00:00.000Z")] };
  const theirs = { ...emptyState(), channels: [channel("2026-11-09T00:00:00.000Z")] };
  assert.equal(mergeStates(mine, theirs).channels[0].polledAt, "2026-11-09T00:00:00.000Z");
  assert.equal(mergeStates(theirs, mine).channels[0].polledAt, "2026-11-09T00:00:00.000Z");
  const never = { ...emptyState(), channels: [channel()] };
  assert.equal(mergeStates(never, theirs).channels[0].polledAt, "2026-11-09T00:00:00.000Z");
});

test("a new channel whose first fetch failed still fills the hub without a push", () => {
  const channel: Channel = { id: "UCbbbbbbbbbbbbbbbbbbbbbb", title: "B", addedAt: "2026-11-01T00:00:00.000Z" };
  assert.equal(isFirstSight(channel, []), true);
  // The round stamps polledAt before the fetch; the fetch then fails.
  channel.polledAt = "2026-11-09T00:00:00.000Z";
  channel.failures = 1;
  assert.equal(isFirstSight(channel, []), true);
  // Once a feed has answered, its later videos are news.
  channel.failures = 0;
  assert.equal(isFirstSight(channel, []), false);
});

test("the Shorts check sends nothing for a video known to run over 3 minutes (GitHub #66 G4)", async () => {
  const { shortsCheck } = await import("../src/subscriptions.ts");
  const item = (durationSeconds: number | null | undefined, isShort: boolean | null = null, state = "new") =>
    ({ isShort, durationSeconds, state }) as Parameters<typeof shortsCheck>[0];
  assert.equal(shortsCheck(item(600)), "long", "a 10-minute video needs no request");
  assert.equal(shortsCheck(item(181)), "long");
  assert.equal(shortsCheck(item(180)), "ask");
  assert.equal(shortsCheck(item(45)), "ask");
  assert.equal(shortsCheck(item(null)), "ask", "YouTube would not say: ask");
  assert.equal(shortsCheck(item(undefined)), "ask", "not known yet: asked, so a Short does not show meanwhile");
  assert.equal(shortsCheck(item(45, true)), "done");
  assert.equal(shortsCheck(item(45, null, "dismissed")), "skip");
});
