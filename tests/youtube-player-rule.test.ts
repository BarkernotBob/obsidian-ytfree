/** GitHub #66 item 7: YouTube's player only when our stream cannot play. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePlayer } from "../src/youtube-player-rule.ts";
import type { StreamTier } from "../src/youtube-player-rule.ts";

const DESKTOP: StreamTier[] = ["yt-dlp", "own"];
const PHONE: StreamTier[] = ["own"];
const calm = { paused: false, retryDue: false };

test("our stream is the default: yt-dlp first on a desktop, our own stream on the phone", () => {
  assert.deepEqual(choosePlayer({ tiers: DESKTOP, failed: new Set(), ...calm }), { use: "stream", tier: "yt-dlp" });
  assert.deepEqual(choosePlayer({ tiers: PHONE, failed: new Set(), ...calm }), { use: "stream", tier: "own" });
});

test("one failed tier falls through to the next, not to YouTube's player", () => {
  assert.deepEqual(choosePlayer({ tiers: DESKTOP, failed: new Set(["yt-dlp"]), ...calm }), {
    use: "stream",
    tier: "own",
  });
});

test("YouTube's player only once every tier this device has failed for this video", () => {
  assert.deepEqual(choosePlayer({ tiers: DESKTOP, failed: new Set(["yt-dlp", "own"]), ...calm }), {
    use: "youtube",
    why: "all-tiers-failed",
  });
  assert.deepEqual(choosePlayer({ tiers: PHONE, failed: new Set(["own"]), ...calm }), {
    use: "youtube",
    why: "all-tiers-failed",
  });
});

test("during a bot-check pause YouTube's player plays, until a retry is due", () => {
  assert.deepEqual(choosePlayer({ tiers: DESKTOP, failed: new Set(), paused: true, retryDue: false }), {
    use: "youtube",
    why: "bot-check",
  });
  assert.deepEqual(choosePlayer({ tiers: DESKTOP, failed: new Set(), paused: true, retryDue: true }), {
    use: "stream",
    tier: "yt-dlp",
  });
});
