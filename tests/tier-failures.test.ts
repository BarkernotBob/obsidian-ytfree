/** GitHub #43 part 1: a stream tier that fails, by resolve or by a dead link, is skipped. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AllTiersFailedError, FAILURE_TTL_MS, resolveByTier, TierFailures } from "../src/tier-failures.ts";
import type { StreamTier } from "../src/youtube-player-rule.ts";

const DESKTOP = (): StreamTier[] => ["yt-dlp", "own"];
const never = () => false;

function run(failures: TierFailures, resolve: (tier: StreamTier) => Promise<{ url: string }>, extra = {}) {
  return resolveByTier({ videoId: "v", tiers: DESKTOP, failures, resolve, stop: never, ...extra });
}

test("yt-dlp first, and the stream says which tier gave it", async () => {
  const s = await run(new TierFailures(), async (tier) => ({ url: tier }));
  assert.deepEqual(s, { url: "yt-dlp", tier: "yt-dlp" });
});

test("a yt-dlp link that would not play: the retry goes to our own stream, not yt-dlp again", async () => {
  // The 2026-11-10 report: yt-dlp kept answering with a link YouTube refused.
  const failures = new TierFailures();
  const asked: StreamTier[] = [];
  const first = await run(failures, async (tier) => (asked.push(tier), { url: tier }));
  failures.mark("v", first.tier); // what the desktop provider does on a refresh of a live link
  const second = await run(failures, async (tier) => (asked.push(tier), { url: tier }));
  assert.equal(second.tier, "own");
  assert.deepEqual(asked, ["yt-dlp", "own"]);
});

test("a yt-dlp resolve error falls through to our own stream in the same call", async () => {
  const failures = new TierFailures();
  const s = await run(failures, async (tier) => {
    if (tier === "yt-dlp") throw new Error("ERROR: unable to extract");
    return { url: "own" };
  });
  assert.equal(s.tier, "own");
  assert.deepEqual([...failures.failed("v")], ["yt-dlp"]);
});

test("both tiers dead: AllTiersFailedError, never a third yt-dlp try", async () => {
  const failures = new TierFailures();
  failures.mark("v", "yt-dlp");
  failures.mark("v", "own");
  let calls = 0;
  await assert.rejects(run(failures, async () => (calls++, { url: "x" })), AllTiersFailedError);
  assert.equal(calls, 0);
});

test("both fail on one call: the first error is the one reported", async () => {
  const failures = new TierFailures();
  await assert.rejects(
    run(failures, async (tier) => {
      throw new Error(`${tier} broke`);
    }),
    /yt-dlp broke/,
  );
});

test("a bot check stops the walk: our own stream is not asked", async () => {
  const failures = new TierFailures();
  const asked: StreamTier[] = [];
  const bot = new Error("bot");
  await assert.rejects(
    run(failures, async (tier) => {
      asked.push(tier);
      throw bot;
    }, { stop: (e: unknown) => e === bot }),
    /bot/,
  );
  assert.deepEqual(asked, ["yt-dlp"]);
  assert.equal(failures.failed("v").size, 0);
});

test("yt-dlp not installed: not marked as this video's failure, own stream plays", async () => {
  let installed = true;
  const failures = new TierFailures();
  const s = await resolveByTier({
    videoId: "v",
    tiers: () => (installed ? ["yt-dlp", "own"] : ["own"]),
    failures,
    resolve: async (tier) => {
      if (tier === "yt-dlp") throw new Error("missing");
      return { url: "own" };
    },
    stop: never,
    onError: () => ((installed = false), false),
  });
  assert.equal(s.tier, "own");
  assert.equal(failures.failed("v").size, 0);
});

test("failures are forgotten after the TTL, and are per video", () => {
  let now = 0;
  const failures = new TierFailures(() => now);
  failures.mark("v", "yt-dlp");
  assert.equal(failures.failed("other").size, 0);
  now = FAILURE_TTL_MS - 1;
  assert.deepEqual([...failures.failed("v")], ["yt-dlp"]);
  now = FAILURE_TTL_MS;
  assert.equal(failures.failed("v").size, 0);
});

// ---- GitHub #121: our own stream is not given up on after one hiccup ---------

test("our own stream's first dead link asks for a fresh link; the second fails it", () => {
  const failures = new TierFailures();
  assert.equal(failures.deadLink("v", "own"), false);
  assert.equal(failures.failed("v").size, 0);
  assert.equal(failures.deadLink("v", "own"), true);
  assert.deepEqual([...failures.failed("v")], ["own"]);
});

test("a yt-dlp dead link still fails yt-dlp at once (#43)", () => {
  const failures = new TierFailures();
  assert.equal(failures.deadLink("v", "yt-dlp"), true);
  assert.deepEqual([...failures.failed("v")], ["yt-dlp"]);
});

test("an old dead link does not count: the strike lapses with the failure window", () => {
  let now = 0;
  const failures = new TierFailures(() => now);
  failures.deadLink("v", "own");
  now += FAILURE_TTL_MS;
  assert.equal(failures.deadLink("v", "own"), false);
});

test("Try our stream again forgets the strike too", () => {
  const failures = new TierFailures();
  failures.deadLink("v", "own");
  failures.clear("v");
  assert.equal(failures.deadLink("v", "own"), false);
});

test("a network blip on the phone is asked once more before our own stream fails", async () => {
  const failures = new TierFailures();
  let calls = 0;
  const blip = Object.assign(new Error("timeout"), { kind: "network" });
  const s = await resolveByTier({
    videoId: "v",
    tiers: () => ["own"],
    failures,
    resolve: async () => {
      calls++;
      if (calls === 1) throw blip;
      return { url: "ok" };
    },
    stop: never,
    transient: (e) => e === blip,
    retryDelayMs: 0,
  });
  assert.equal(s.url, "ok");
  assert.equal(calls, 2);
  assert.equal(failures.failed("v").size, 0);
});

test("two blips in a row: the tier fails, once retried, never a third ask", async () => {
  const failures = new TierFailures();
  let calls = 0;
  await assert.rejects(
    resolveByTier({
      videoId: "v",
      tiers: () => ["own"],
      failures,
      resolve: async () => {
        calls++;
        throw new Error("timeout");
      },
      stop: never,
      transient: () => true,
      retryDelayMs: 0,
    }),
    /timeout/,
  );
  assert.equal(calls, 2);
  assert.deepEqual([...failures.failed("v")], ["own"]);
});

test("an answer from YouTube (unplayable) is not retried", async () => {
  const failures = new TierFailures();
  let calls = 0;
  await assert.rejects(
    resolveByTier({
      videoId: "v",
      tiers: () => ["own"],
      failures,
      resolve: async () => {
        calls++;
        throw new Error("Video unavailable");
      },
      stop: never,
      transient: () => false,
      retryDelayMs: 0,
    }),
  );
  assert.equal(calls, 1);
});
