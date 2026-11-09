/**
 * Request ceilings per user action (GitHub #66, sub-point 1).
 *
 * Each test drives the real `src/innertube.ts` against the recorded fixtures
 * and counts the requests it sends. A change that makes an action cost more
 * than its ceiling fails here, before it reaches YouTube.
 *
 * `innertube.ts` imports `requestUrl` from `obsidian`, which does not exist
 * under node --test, so the module is swapped for a stub that answers from
 * the fixtures and records every call.
 *
 * Elsewhere: desktop HD starts in 2 reads (replay.test.ts, adaptive.test.ts);
 * the Shorts check sends nothing for a video known to run over 3 minutes
 * (feed-schedule.test.ts); a bot check stops Play until a retry is due and
 * background work until one succeeds (bot-check.test.ts); YouTube's player
 * only when our stream cannot play (youtube-player-rule.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const STUB = `data:text/javascript,${encodeURIComponent(
  "export const requestUrl = (req) => globalThis.__ytfreeRequestUrl(req);",
)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "obsidian") return { url: STUB, shortCircuit: true };
    return next(specifier, context);
  },
});

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;

/** The player answer with one English caption track added. */
function playerWithCaptions(): unknown {
  const answer = fixture("player-android-ok.json") as Record<string, unknown>;
  return {
    ...answer,
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en", languageCode: "en" }],
      },
    },
  };
}

interface Sent {
  url: string;
}
const sent: Sent[] = [];
let botChecked = false;
(globalThis as Record<string, unknown>).__ytfreeRequestUrl = (req: { url: string }) => {
  sent.push({ url: req.url });
  let body: unknown;
  if (req.url.includes("/player")) body = botChecked ? fixture("player-bot-check.json") : playerWithCaptions();
  else if (req.url.includes("/search")) body = fixture("search-android.json");
  else if (req.url.includes("/browse")) body = fixture("channel-videos-web.json");
  else if (req.url.includes("timedtext")) body = { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "hi" }] }] };
  else body = {};
  return Promise.resolve({ status: 200, text: JSON.stringify(body) });
};

const yt = await import("../src/innertube.ts");

/** Requests `action` sends. */
async function count(action: () => Promise<unknown>): Promise<string[]> {
  sent.length = 0;
  await action();
  return sent.map((s) => s.url);
}

test("a search costs one request a page", async () => {
  assert.equal((await count(() => yt.searchYouTube("cats"))).length, 1);
  assert.equal((await count(() => yt.searchYouTube("cats", undefined, "TOKEN"))).length, 1);
});

test("a channel screen costs one request a page", async () => {
  const channel = { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", channelTitle: "A" };
  assert.equal((await count(() => yt.browseChannel(channel))).length, 1);
});

test("opening a video asks the player once, however many facts are read from it", async () => {
  const urls = await count(async () => {
    await yt.fetchVideoDetails("ceil0000001");
    await yt.fetchCaptionTrack("ceil0000001", "en");
    await yt.fetchPlayer("ceil0000001", "android");
  });
  assert.equal(urls.length, 1);
});

test("a transcript costs at most the player answer and one captions fetch", async () => {
  const urls = await count(() => yt.fetchTranscriptCues("ceil0000002", "en"));
  assert.ok(urls.length <= 2, urls.join("\n"));
  assert.equal(urls.filter((u) => u.includes("/player")).length, 1);
  // With the player answer already kept, it is the captions fetch alone.
  assert.equal((await count(() => yt.fetchTranscriptCues("ceil0000002", "en"))).length, 1);
});

test("after a bot check, automatic work sends nothing and Play waits for its retry (GitHub #66)", async () => {
  const { botCheck } = await import("../src/bot-check.ts");
  const hd = await import("../src/hd.ts");
  botCheck.clear();
  botChecked = true;
  try {
    // The bot check arrives on an ordinary player call and trips the breaker.
    assert.equal((await count(() => yt.fetchPlayer("ceil0000003", "android"))).length, 1);
    assert.equal(botCheck.isPaused(), true);
    // HD is automatic: refused before any request leaves.
    assert.deepEqual(await count(() => hd.resolvePhoneHdStream("ceil0000003").catch(() => null)), []);
    // Play is refused too until the first retry (1 minute) is due.
    assert.throws(() => botCheck.guardPlay());
  } finally {
    botChecked = false;
    botCheck.clear();
  }
});
