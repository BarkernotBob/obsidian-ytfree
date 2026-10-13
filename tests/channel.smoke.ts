/**
 * Live check of the channel screen's calls (issue 045) — hits YouTube for real.
 *
 * The unit tests read recorded pages; this one proves the continuation call,
 * which was only ever recorded with the wrong token. Run with `npm run smoke`
 * on a machine that can reach youtube.com.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BROWSE_URL, CLIENTS } from "../src/innertube-context.ts";
import {
  CHANNEL_SEARCH_PARAMS,
  CHANNEL_VIDEOS_PARAMS,
  parseChannelResponse,
} from "../src/channel.ts";

const CHANNEL = { channelId: "UCKRmL7BMyCeLE4KUo73RDzw", channelTitle: "Ward on Words" };

async function browse(body: Record<string, unknown>): Promise<unknown> {
  const { ctx, ua } = CLIENTS.web;
  const res = await fetch(BROWSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({ ...body, context: { client: { ...ctx, hl: "en", gl: "US" } } }),
  });
  assert.equal(res.status, 200, `browse answered HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

test("the Videos tab pages: page two follows page one with new videos", async () => {
  const first = parseChannelResponse(
    await browse({ browseId: CHANNEL.channelId, params: CHANNEL_VIDEOS_PARAMS }),
    CHANNEL,
  );
  assert.ok(first.results.length >= 20, `page one had ${first.results.length}`);
  assert.ok(first.continuation, "no continuation on page one");

  const second = parseChannelResponse(await browse({ continuation: first.continuation }), CHANNEL);
  assert.ok(second.results.length >= 10, `page two had ${second.results.length}`);
  const seen = new Set(first.results.map((r) => r.videoId));
  assert.ok(second.results.every((r) => !seen.has(r.videoId)), "page two repeated page one");
});

test("a search inside the channel finds that channel's videos", async () => {
  const page = parseChannelResponse(
    await browse({ browseId: CHANNEL.channelId, params: CHANNEL_SEARCH_PARAMS, query: "translation" }),
    CHANNEL,
  );
  assert.ok(page.results.length > 0);
  assert.ok(page.results.every((r) => r.channelId === CHANNEL.channelId));
});
