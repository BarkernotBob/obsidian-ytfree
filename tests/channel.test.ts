/**
 * The channel parser (issue 045), against responses recorded on 2026-10-13
 * with `tools/record-channel-fixtures.mjs` and trimmed of tracking and menu
 * noise (the parser's output is identical on the raw and trimmed files).
 *
 * The channel is Ward on Words, `UCKRmL7BMyCeLE4KUo73RDzw`: one of the
 * subscribed channels, and the one whose collab started GitHub #2.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  channelUrl,
  isChannelId,
  parseChannelHeader,
  parseChannelResponse,
  parseShortViews,
} from "../src/channel.ts";
import { channelScreen } from "../src/search-screen.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

const CHANNEL = { channelId: "UCKRmL7BMyCeLE4KUo73RDzw", channelTitle: "Ward on Words" };
const videos = fixture("channel-videos-web.json");
const search = fixture("channel-search-web.json");

// ------------------------------------------------------------------ header

test("reads the channel's name, handle, counts and a small avatar", () => {
  const header = parseChannelHeader(videos);
  assert.ok(header);
  assert.equal(header.channelId, CHANNEL.channelId);
  assert.equal(header.title, "Ward on Words");
  assert.equal(header.handle, "@wardonwords");
  assert.match(header.subscribers, /subscribers$/);
  assert.match(header.videos, /^\d[\d,]* videos$/);
  // The 72px one, not the 900px one from the metadata block.
  assert.match(header.avatar, /=s72-/);
});

test("a response with no channel in it has no header", () => {
  assert.equal(parseChannelHeader({}), null);
  assert.equal(parseChannelHeader(null), null);
});

// ------------------------------------------------------------- videos tab

test("page one of the Videos tab: every playable video, newest first", () => {
  const page = parseChannelResponse(videos, CHANNEL);
  // 30 on the page; two are members-only and cannot play signed out.
  assert.equal(page.results.length, 28);
  for (const result of page.results) {
    assert.match(result.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.ok(result.title && result.title !== result.videoId);
    assert.equal(result.channelId, CHANNEL.channelId);
    assert.equal(result.channelTitle, "Ward on Words");
    assert.match(result.publishedText, /ago$/);
    assert.match(result.duration, /^\d{1,2}(:\d{2}){1,2}$/);
    assert.match(result.thumbnail, /^https:\/\/i\.ytimg\.com\//);
    assert.equal(result.secondary, false);
  }
  assert.equal(page.results[0].videoId, "Z4Ql-1GnK0g");
  assert.equal(page.results[0].publishedText, "5 days ago");
});

test("members-only videos are not offered", () => {
  const ids = parseChannelResponse(videos, CHANNEL).results.map((r) => r.videoId);
  // "Members first" on the day this was recorded.
  assert.ok(!ids.includes("4SWZjKBR6cI"));
});

test("the next page's token is the grid's own, not the header's", () => {
  const page = parseChannelResponse(videos, CHANNEL);
  assert.ok(page.continuation);
  // A grid continuation names the channel and the videos tab in its payload;
  // the header's tokens open the About panel instead.
  assert.ok(page.continuation.startsWith("4qmFsgLdCBIYVUNLUm1MN0JNeUNlTEU0S1VvNzNS"));
});

test("views are read from YouTube's rounded form", () => {
  const page = parseChannelResponse(videos, CHANNEL);
  const lament = page.results.find((r) => r.videoId === "Z4Ql-1GnK0g");
  assert.equal(lament?.views, 4500);
});

test("the collab from GitHub #2 is not on its collaborator's Videos tab", () => {
  // The finding that sent #2 to the subscription feed instead: the RBN upload
  // `-X4ZD3fisSs` (Aug 3) is newer than the oldest video on this page, and not
  // on it. YouTube lists a collab only under the channel that uploaded it.
  const ids = parseChannelResponse(videos, CHANNEL).results.map((r) => r.videoId);
  assert.ok(!ids.includes("-X4ZD3fisSs"));
});

// ------------------------------------------------------------ continuation

test("a continuation appends grid items and hands on the next token", () => {
  // Hand-built in the envelope YouTube uses for every grid continuation; the
  // live check of the same call is `tests/channel.smoke.ts`.
  const lockup = (id: string): unknown => ({
    richItemRenderer: {
      content: {
        lockupViewModel: {
          contentId: id,
          contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
          contentImage: {
            thumbnailViewModel: {
              image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hq720.jpg`, width: 360 }] },
              overlays: [
                { thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: "12:01" } }] } },
              ],
            },
          },
          metadata: {
            lockupMetadataViewModel: {
              title: { content: `Video ${id}` },
              metadata: {
                contentMetadataViewModel: {
                  metadataRows: [
                    { metadataParts: [{ text: { content: "1.2M views" } }, { text: { content: "8 months ago" } }] },
                  ],
                },
              },
            },
          },
        },
      },
    },
  });
  const raw = {
    onResponseReceivedActions: [
      {
        appendContinuationItemsAction: {
          continuationItems: [
            lockup("aaaaaaaaaaa"),
            lockup("bbbbbbbbbbb"),
            { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "NEXT" } } } },
          ],
        },
      },
    ],
  };
  const page = parseChannelResponse(raw, CHANNEL);
  assert.equal(page.header, null);
  assert.deepEqual(
    page.results.map((r) => [r.videoId, r.channelTitle, r.views, r.duration, r.publishedText]),
    [
      ["aaaaaaaaaaa", "Ward on Words", 1200000, "12:01", "8 months ago"],
      ["bbbbbbbbbbb", "Ward on Words", 1200000, "12:01", "8 months ago"],
    ],
  );
  assert.equal(page.continuation, "NEXT");
});

test("the last page has no token", () => {
  const page = parseChannelResponse(
    { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [] } }] },
    CHANNEL,
  );
  assert.deepEqual(page.results, []);
  assert.equal(page.continuation, null);
});

// ------------------------------------------------------------------ search

test("a search inside the channel reads the Search tab", () => {
  const page = parseChannelResponse(search, CHANNEL);
  assert.equal(page.results.length, 13);
  assert.equal(page.header?.title, "Ward on Words");
  for (const result of page.results) {
    assert.match(result.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(result.channelId, CHANNEL.channelId);
    assert.ok(result.duration);
  }
  // The full count, not the rounded one, on this renderer.
  assert.ok(page.results.some((r) => r.views !== null && r.views % 1000 !== 0));
});

// ------------------------------------------------------------- hostile input

test("nothing in, nothing out — never a throw", () => {
  for (const raw of [null, undefined, 42, "x", [], {}, { contents: { twoColumnBrowseResultsRenderer: { tabs: [null, 3] } } }]) {
    const page = parseChannelResponse(raw, CHANNEL);
    assert.deepEqual(page.results, []);
    assert.equal(page.continuation, null);
  }
});

// ------------------------------------------------------------------- small

test("parseShortViews reads every spelling YouTube uses", () => {
  assert.equal(parseShortViews("4.5K views"), 4500);
  assert.equal(parseShortViews("1.2M views"), 1200000);
  assert.equal(parseShortViews("3B views"), 3000000000);
  assert.equal(parseShortViews("5,736 views"), 5736);
  assert.equal(parseShortViews("1 view"), 1);
  assert.equal(parseShortViews("No views"), null);
});

test("channel ids and the Subscribe URL", () => {
  assert.ok(isChannelId("UCKRmL7BMyCeLE4KUo73RDzw"));
  assert.ok(!isChannelId("@wardonwords"));
  assert.equal(
    channelUrl("UCKRmL7BMyCeLE4KUo73RDzw"),
    "https://www.youtube.com/channel/UCKRmL7BMyCeLE4KUo73RDzw",
  );
});

// ------------------------------------------------------------------ words

const base = { title: "Ward on Words", query: null, state: "idle", error: "", results: 0, videosText: "" } as const;

test("the channel screen says what it is doing", () => {
  assert.equal(channelScreen({ ...base, state: "loading" }).kind, "loading");
  assert.equal(channelScreen({ ...base, state: "loading" }).status, "Loading Ward on Words…");
  const failed = channelScreen({ ...base, state: "error", error: "offline" });
  assert.equal(failed.kind, "error");
  assert.ok(failed.retry);
  assert.equal(channelScreen({ ...base, results: 28, videosText: "418 videos" }).status, "28 shown of 418 videos · newest first");
  assert.equal(
    channelScreen({ ...base, query: "baptism", results: 3 }).status,
    "3 results for “baptism” in Ward on Words",
  );
  assert.equal(channelScreen({ ...base, query: "zzz" }).kind, "none");
  assert.match(channelScreen({ ...base, query: "zzz" }).help, /clear the box/);
  // Before the header has named it.
  assert.equal(channelScreen({ ...base, title: "", state: "loading" }).status, "Loading this channel…");
});
