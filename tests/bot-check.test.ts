import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BOT_CHECK_COOLDOWN_MS,
  BotCheckBreaker,
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

test("a trip pauses for 45 minutes, then lifts on its own", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  assert.equal(breaker.isPaused(), false);
  breaker.trip();
  assert.equal(breaker.pausedUntil(), c.now() + BOT_CHECK_COOLDOWN_MS);
  c.advance(BOT_CHECK_COOLDOWN_MS - 1);
  assert.equal(breaker.isPaused(), true);
  c.advance(1);
  assert.equal(breaker.isPaused(), false);
  assert.equal(breaker.message(), null);
});

test("a second bot check during the pause extends it", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  breaker.trip();
  c.advance(30 * 60_000);
  breaker.trip();
  assert.equal(breaker.pausedUntil(), c.now() + BOT_CHECK_COOLDOWN_MS);
});

test("guard throws the pause message while paused and nothing otherwise", () => {
  const c = clock();
  const breaker = new BotCheckBreaker(c.now);
  breaker.guard();
  breaker.trip();
  assert.throws(() => breaker.guard(), (err: unknown) => {
    assert.ok(err instanceof BotCheckPausedError);
    assert.equal((err as Error).message, pauseMessage(c.now() + BOT_CHECK_COOLDOWN_MS));
    return true;
  });
});

test("the pause survives a reload through the store", () => {
  const c = clock();
  const store = memoryStore();
  const first = new BotCheckBreaker(c.now);
  first.attach(store);
  first.trip();

  const reloaded = new BotCheckBreaker(c.now);
  reloaded.attach(store);
  assert.equal(reloaded.pausedUntil(), c.now() + BOT_CHECK_COOLDOWN_MS);

  reloaded.clear();
  assert.equal(store.peek(), null);
});

test("an expired or unreadable stored pause is no pause", () => {
  const c = clock();
  const old = new BotCheckBreaker(c.now);
  old.attach(memoryStore(String(c.now() - 1)));
  assert.equal(old.isPaused(), false);

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
  breaker.trip();
  assert.equal(heard, 1);
});

test("the message names the end time on the device's clock", () => {
  const until = new Date(2026, 10, 7, 9, 5).getTime();
  assert.equal(clockTime(until), "09:05");
  assert.match(pauseMessage(until), /prove it isn't a bot\. YT Free is pausing its requests until 09:05\.$/);
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
