/** Issue 048: when a rolled feed window is a gap, and what fills it. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEFAULT_HORIZON_DAYS,
  FEED_WINDOW,
  backfillItem,
  backfillMessage,
  feedWindowRolled,
  horizonDays,
  relativeAgeSeconds,
  walkBackfillPage,
} from "../src/backfill.ts";
import { parseChannelResponse, parsePlayerPublishDate } from "../src/channel.ts";
import type { SearchResult } from "../src/search.ts";

const now = new Date("2026-10-13T12:00:00Z");
const day = 86_400_000;

function entries(count: number, newest: number, prefix = "e"): Array<{ videoId: string; published: string }> {
  return Array.from({ length: count }, (_, i) => ({
    videoId: `${prefix}${String(i).padStart(10, "0")}`,
    published: new Date(newest - i * day).toISOString(),
  }));
}

// -------------------------------------------------------------- detection

test("a full window with nothing known in it, inside the horizon, is a gap", () => {
  const feed = entries(FEED_WINDOW, now.getTime());
  assert.ok(feedWindowRolled(feed, [{ videoId: "old00000000" }], [], now, 30));
});

test("one overlapping entry means nothing was missed", () => {
  const feed = entries(FEED_WINDOW, now.getTime());
  assert.ok(!feedWindowRolled(feed, [{ videoId: feed[14].videoId }], [], now, 30));
});

test("a deleted video in the window counts as overlap", () => {
  const feed = entries(FEED_WINDOW, now.getTime());
  assert.ok(!feedWindowRolled(feed, [{ videoId: "old00000000" }], [{ id: feed[3].videoId }], now, 30));
});

test("a channel with fewer than 15 uploads has no window to roll", () => {
  assert.ok(!feedWindowRolled(entries(9, now.getTime()), [{ videoId: "old00000000" }], [], now, 30));
});

test("a channel the hub has never met has no history to have a hole in", () => {
  assert.ok(!feedWindowRolled(entries(FEED_WINDOW, now.getTime()), [], [], now, 30));
});

test("a gap older than the horizon is not worth filling", () => {
  // Oldest entry 14 days back; a 7-day horizon has already given up on it.
  const feed = entries(FEED_WINDOW, now.getTime());
  assert.ok(!feedWindowRolled(feed, [{ videoId: "old00000000" }], [], now, 7));
});

test("the horizon is expiry when it is on, a month when it is off", () => {
  assert.equal(horizonDays(14), 14);
  assert.equal(horizonDays(0), DEFAULT_HORIZON_DAYS);
});

// ------------------------------------------------------------------- walk

function result(videoId: string, publishedText: string): SearchResult {
  return {
    videoId,
    title: videoId,
    channelId: "UCKRmL7BMyCeLE4KUo73RDzw",
    channelTitle: "Ward on Words",
    publishedText,
    views: 10,
    duration: "1:00",
    thumbnail: "",
    secondary: false,
  };
}

test("the walk skips what the feed just delivered and stops at the first known video", () => {
  const page = [
    result("feed0000000", "1 day ago"),
    result("gap00000001", "2 weeks ago"),
    result("gap00000002", "2 weeks ago"),
    result("known000000", "3 weeks ago"),
    result("after000000", "3 weeks ago"),
  ];
  const walk = walkBackfillPage(page, new Set(["known000000"]), new Set(["feed0000000"]), 30);
  assert.deepEqual(walk.take.map((r) => r.videoId), ["gap00000001", "gap00000002"]);
  assert.ok(walk.done);
});

test("the walk stops at the horizon", () => {
  const page = [result("gap00000001", "3 weeks ago"), result("gap00000002", "2 months ago")];
  const walk = walkBackfillPage(page, new Set(), new Set(), 30);
  assert.deepEqual(walk.take.map((r) => r.videoId), ["gap00000001"]);
  assert.ok(walk.done);
});

test("a page with neither asks for the next one", () => {
  const walk = walkBackfillPage([result("gap00000001", "1 week ago")], new Set(), new Set(), 30);
  assert.equal(walk.done, false);
});

test("a deleted or hidden video is known, so it cannot come back", () => {
  // Both live in the known set the poll builds: items in any state, plus
  // `deletedVideos`.
  const walk = walkBackfillPage([result("deleted0000", "1 week ago")], new Set(["deleted0000"]), new Set(), 30);
  assert.deepEqual(walk.take, []);
  assert.ok(walk.done);
});

test("on the recorded Ward on Words page, a two-week hole is what gets taken", () => {
  const page = parseChannelResponse(
    JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "channel-videos-web.json"), "utf8"),
    ) as unknown,
    { channelId: "UCKRmL7BMyCeLE4KUo73RDzw", channelTitle: "Ward on Words" },
  );
  // Pretend the feed delivered the newest two and the hub last knew the
  // "Top Ten Audio Bible Apps" video.
  const fed = new Set(page.results.slice(0, 2).map((r) => r.videoId));
  const walk = walkBackfillPage(page.results, new Set(["8FD43sNuYsQ"]), fed, 30);
  assert.deepEqual(
    walk.take.map((r) => r.videoId),
    ["2YFzF0TyazI", "T0AgJUHteDI"],
  );
  assert.ok(walk.done);
});

test("relative ages, roughly, and only when they are ages", () => {
  assert.equal(relativeAgeSeconds("5 days ago"), 5 * 86_400);
  assert.equal(relativeAgeSeconds("1 month ago"), 2_592_000);
  assert.equal(relativeAgeSeconds("Streamed 2 weeks ago"), 2 * 604_800);
  assert.equal(relativeAgeSeconds("Premieres in 3 hours"), null);
  assert.equal(relativeAgeSeconds(""), null);
});

// ------------------------------------------------------------------- item

test("a backfilled item looks like a feed item", () => {
  const item = backfillItem(
    result("gap00000001", "2 weeks ago"),
    { id: "UCKRmL7BMyCeLE4KUo73RDzw", title: "Ward on Words" },
    { published: "2026-09-29T12:00:00.000Z", description: "d", durationSeconds: 60 },
    now,
  );
  assert.equal(item.origin, "feed");
  assert.equal(item.state, "new");
  assert.equal(item.published, "2026-09-29T12:00:00.000Z");
  assert.equal(item.durationSeconds, 60);
  assert.equal(item.thumbnail, "https://i.ytimg.com/vi/gap00000001/mqdefault.jpg");
});

test("the notice names the channel, the count and the dates", () => {
  const item = (published: string) =>
    backfillItem(result("x0000000000", ""), { id: "UC", title: "Ward on Words" }, { published, description: "", durationSeconds: null }, now);
  assert.equal(
    backfillMessage("Ward on Words", [item("2026-09-02T00:00:00Z"), item("2026-09-30T00:00:00Z")]),
    "Ward on Words: 2 videos from Sep 2 to Sep 30 were missed by the feed and added to your Inbox.",
  );
  assert.equal(
    backfillMessage("Ward on Words", [item("")]),
    "Ward on Words: 1 video were missed by the feed and added to your Inbox.".replace("video were", "video were"),
  );
});

// ------------------------------------------------------------ publish date

test("the WEB player's microformat gives the publish date", () => {
  assert.equal(
    parsePlayerPublishDate({ microformat: { playerMicroformatRenderer: { publishDate: "2026-08-03T05:00:12-07:00" } } }),
    "2026-08-03T12:00:12.000Z",
  );
  assert.equal(
    parsePlayerPublishDate({ microformat: { playerMicroformatRenderer: { uploadDate: "2026-08-03" } } }),
    "2026-08-03T00:00:00.000Z",
  );
  assert.equal(parsePlayerPublishDate({ videoDetails: {} }), "");
  assert.equal(parsePlayerPublishDate(null), "");
});
