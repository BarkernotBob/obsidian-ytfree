/**
 * Big imports must not burst (GitHub #66, sub-point 2): channel feeds are
 * fetched in rounds of the stalest channels, the period stretches with the
 * list, and both the round gap and the feed gap are jittered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DURATIONS_PER_PERIOD,
  FEEDS_PER_HOUR,
  FEED_GAP_MIN_MS,
  FEED_GAP_SPREAD_MS,
  MIN_ROUND_MS,
  ROUND_JITTER,
  ROUND_MAX_CHANNELS,
  durationsPerRound,
  feedGapMs,
  jitteredRoundMs,
  pickRound,
  pollPeriodMs,
  roundIntervalMs,
  roundSize,
  roundsPerPeriod,
} from "../src/feed-schedule.ts";
import { emptyState, isFirstSight, mergeStates } from "../src/subscriptions.ts";
import type { Channel } from "../src/subscriptions.ts";

const HOUR = 3_600_000;

test("a short list is one round at the configured period, unchanged", () => {
  assert.equal(roundsPerPeriod(20), 1);
  assert.equal(roundSize(20), 20);
  assert.equal(roundIntervalMs(120, 20), 2 * HOUR);
});

test("a Takeout-sized import never averages more than FEEDS_PER_HOUR feeds an hour", () => {
  for (const count of [26, 100, 300, 600, 1500]) {
    for (const minutes of [5, 60, 120]) {
      const perHour = (roundSize(count) / roundIntervalMs(minutes, count)) * HOUR;
      assert.ok(perHour <= FEEDS_PER_HOUR + 1e-9, `${count} channels @${minutes}m: ${perHour}/h`);
      assert.ok(roundSize(count) <= ROUND_MAX_CHANNELS);
    }
  }
});

test("the period stretches with the channel count and every channel is still covered", () => {
  assert.equal(pollPeriodMs(120, 600), 5 * HOUR);
  const count = 600;
  assert.ok(roundSize(count) * roundsPerPeriod(count) >= count);
});

test("rounds never run closer than five minutes", () => {
  assert.ok(roundIntervalMs(5, 10_000) >= MIN_ROUND_MS);
  assert.ok(jitteredRoundMs(5, 30, () => 0) >= MIN_ROUND_MS);
});

test("round gaps are only ever lengthened by jitter, so the hourly ceiling holds", () => {
  const base = roundIntervalMs(120, 100);
  assert.equal(jitteredRoundMs(120, 100, () => 0), Math.round(base));
  assert.ok(jitteredRoundMs(120, 100, () => 0.999) <= Math.round(base * (1 + 2 * ROUND_JITTER)));
  for (const count of [100, 600, 1500]) {
    const perHour = (roundSize(count) / jitteredRoundMs(5, count, () => 0)) * HOUR;
    assert.ok(perHour <= FEEDS_PER_HOUR + 1e-6, `${count} channels: ${perHour}/h`);
  }
});

test("feed gaps inside a round are jittered within their bounds", () => {
  assert.equal(feedGapMs(() => 0), FEED_GAP_MIN_MS);
  assert.ok(feedGapMs(() => 0.999) < FEED_GAP_MIN_MS + FEED_GAP_SPREAD_MS);
});

test("a round picks never-checked channels first, then the oldest, in list order", () => {
  const channels: Array<{ id: string; polledAt?: string }> = [];
  for (let i = 0; i < 60; i++) {
    channels.push({ id: `c${i}`, polledAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() });
  }
  channels.push({ id: "fresh-a" }, { id: "fresh-b" });
  const round = pickRound(channels);
  assert.equal(round.length, roundSize(62));
  assert.deepEqual(round.slice(0, 3).map((c) => c.id), ["fresh-a", "fresh-b", "c0"]);
  // Stamping the round sends the next round on to the rest of the list.
  for (const channel of round) channel.polledAt = "2026-11-09T00:00:00.000Z";
  const next = pickRound(channels);
  assert.ok(next.every((c) => !round.includes(c)));
});

test("duration look-ups per round shrink as rounds multiply, never to zero", () => {
  assert.equal(durationsPerRound(10), DURATIONS_PER_PERIOD);
  assert.equal(durationsPerRound(600), 1);
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
