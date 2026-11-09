import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BotCheckBreaker,
  RETRY_SCHEDULE_MS,
  BotCheckPausedError,
  clockTime,
  isBotCheck,
  isBotCheckPlayability,
  pauseMessage,
} from "../src/bot-check.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const player = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as {
    playabilityStatus: { status: string; reason: string };
  };

function clock(start = Date.UTC(2026, 10, 7, 20, 0)) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function memoryStore(initial: string | null = null) {
  let value = initial;
  return { read: () => value, write: (v: string | null) => (value = v), peek: () => value };
}

test("yt-dlp's bot-check error is recognised, curly apostrophe or straight", () => {
  assert.ok(isBotCheck(new Error("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies")));
  assert.ok(isBotCheck(new Error("Sign in to confirm you're not a bot")));
  assert.ok(!isBotCheck(new Error("HTTP Error 403: Forbidden")));
});

test("a bot-check player response is a bot check; an age gate is not", () => {
  const bot = player("player-bot-check.json").playabilityStatus;
  const age = player("player-login-required.json").playabilityStatus;
  assert.ok(isBotCheckPlayability(bot.status, bot.reason));
  assert.ok(!isBotCheckPlayability(age.status, age.reason));
  assert.ok(!isBotCheckPlayability("OK", undefined));
  assert.ok(!isBotCheckPlayability("LOGIN_REQUIRED", undefined));
});

const MIN = 60_000;

test("the retry waits are 1, 5, 10, 30 min, 1 h, 2 h, then every 6 h", () => {
  assert.deepEqual(RETRY_SCHEDULE_MS.map((ms) => ms / MIN), [1, 5, 10, 30, 60, 120, 360]);
});

test("each failed Play retry moves to the next wait; the last wait repeats", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  const waits: number[] = [];
  for (let i = 0; i < 9; i++) {
    breaker.trip(); // the first bot check, then each retry that met it again
    const next = breaker.pausedUntil()!;
    waits.push((next - c.now()) / MIN);
    c.advance(next - c.now()); // the reader presses Play the moment it is due
  }
  assert.deepEqual(waits, [1, 5, 10, 30, 60, 120, 360, 360, 360]);
});

test("a bot check while still waiting (a request in flight) does not lengthen the wait", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  breaker.trip();
  const next = breaker.pausedUntil();
  c.advance(10_000);
  breaker.trip();
  breaker.trip();
  assert.equal(breaker.pausedUntil(), next);
  assert.equal(breaker.strikeCount(), 1);
});

test("background work stays paused past the retry time; Play is let through only once it is due", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  breaker.guardPlay(); // no pause: Play goes
  breaker.trip();
  assert.throws(() => breaker.guardPlay(), BotCheckPausedError);
  assert.throws(() => breaker.guard(), BotCheckPausedError);
  c.advance(MIN);
  assert.equal(breaker.retryDue(), true);
  breaker.guardPlay(); // the retry
  assert.throws(() => breaker.guard(), BotCheckPausedError, "polls still wait for a success");
  c.advance(48 * 60 * MIN);
  assert.equal(breaker.isPaused(), true, "no timer ends the pause");
});

test("a success sent during the pause ends it; one sent before it began does not", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  const before = c.now();
  c.advance(1000);
  breaker.trip();
  breaker.succeeded(before);
  assert.equal(breaker.isPaused(), true, "an answer to an older request proves nothing");
  c.advance(MIN);
  breaker.succeeded(c.now());
  assert.equal(breaker.isPaused(), false);
  assert.equal(breaker.message(), null);
  breaker.guard();
  // The next bot check starts again at 1 minute.
  breaker.trip();
  assert.equal(breaker.pausedUntil()! - c.now(), MIN);
});

test("guard throws the pause message while paused and nothing otherwise", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  breaker.guard();
  breaker.trip();
  assert.throws(() => breaker.guard(), (err: unknown) => {
    assert.ok(err instanceof BotCheckPausedError);
    assert.equal((err as Error).message, pauseMessage(c.now() + MIN, c.now()));
    return true;
  });
});

test("the pause and its strike count survive a reload through the store", () => {
  const c = clock();
  const store = memoryStore();
  const first = new BotCheckBreaker(c.now);
  first.attach(store);
  first.trip();
  c.advance(MIN);
  first.trip();

  const reloaded = new BotCheckBreaker(c.now);
  reloaded.attach(store);
  assert.equal(reloaded.strikeCount(), 2);
  assert.equal(reloaded.pausedUntil(), c.now() + 5 * MIN);
  // Any success after a reload ends it: the request was sent during the pause.
  reloaded.succeeded(c.now());
  assert.equal(store.peek(), null);
});

test("an older build's stored end time still pauses until then, and not after", () => {
  const c = clock();
  const live = new BotCheckBreaker(c.now);
  live.attach(memoryStore(String(c.now() + 20 * MIN)));
  assert.equal(live.isPaused(), true);
  assert.equal(live.pausedUntil(), c.now() + 20 * MIN);
})

test("an expired or unreadable stored pause is no pause", () => {
  const c = clock();
  const old = new BotCheckBreaker(c.now);
  old.attach(memoryStore(String(c.now() - 1)));
  assert.equal(old.isPaused(), false);
  const garbled = new BotCheckBreaker(c.now);
  garbled.attach(memoryStore("{not json"));
  assert.equal(garbled.isPaused(), false);

  const broken = new BotCheckBreaker(c.now);
  broken.attach({ read: () => { throw new Error("no storage"); }, write: () => { throw new Error("no storage"); } });
  broken.trip(); // still pauses in memory
  assert.equal(broken.isPaused(), true);
});

test("listeners hear trips, and one that throws does not stop the rest", () => {
  const breaker = new BotCheckBreaker(clock().now);
  let heard = 0;
  breaker.onChange(() => { throw new Error("boom"); });
  const off = breaker.onChange(() => heard++);
  breaker.trip();
  assert.equal(heard, 1);
  off();
  breaker.clear();
  assert.equal(heard, 1);
});

test("the message names the next retry on the device's clock, or the next Play once due", () => {
  const next = new Date(2026, 10, 7, 9, 5).getTime();
  assert.equal(clockTime(next), "09:05");
  assert.match(pauseMessage(next, next - 1), /prove it isn't a bot\. .*first video you play after 09:05\.$/);
  assert.match(pauseMessage(next, next), /try again with the next video you play\.$/);
});

test("the resolver tries yt-dlp once on a bot check, signed out, and pauses", async () => {
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync: read } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { resolveStream } = await import("../src/desktop/resolver.ts");
  const { botCheck } = await import("../src/bot-check.ts");

  // A stand-in yt-dlp that logs its arguments and answers with the bot check.
  const dir = mkdtempSync(join(tmpdir(), "ytfree-botcheck-"));
  const log = join(dir, "calls.log");
  const fake = join(dir, "yt-dlp");
  writeFileSync(
    fake,
    `#!/bin/sh\necho "$@" >> "${log}"\necho "ERROR: [youtube] x: Sign in to confirm you’re not a bot." >&2\nexit 1\n`,
  );
  chmodSync(fake, 0o755);

  botCheck.clear();
  await assert.rejects(resolveStream("dQw4w9WgXcQ", fake, "fast"), /not a bot/);
  const calls = read(log, "utf8").trim().split("\n");
  assert.equal(calls.length, 1, "no second client after a bot check");
  assert.ok(!calls[0].includes("--cookies"), "no automatic signed-in retry");
  assert.equal(botCheck.isPaused(), true);
  botCheck.clear();
});
