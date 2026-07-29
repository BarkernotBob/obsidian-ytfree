import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubItem } from "../src/subscriptions.ts";
import {
  buildWatchLaterNote,
  expireItems,
  extractChannelIdFromHtml,
  feedUrl,
  formatViews,
  mergeChannels,
  mergeItems,
  normalizeState,
  parseChannelFeed,
  parseChannelInput,
  parseSubscriptionsCsv,
  relativeAge,
  sanitizeFileName,
  searchResultToItem,
  visibleItems,
} from "../src/subscriptions.ts";

const CHANNEL = "UC6107grRI4m0o2-emgoDnAA";
const NOW = new Date("2026-07-27T12:00:00Z");

function item(overrides: Partial<HubItem> = {}): HubItem {
  return {
    videoId: "vS6HEes8daw",
    channelId: CHANNEL,
    channelTitle: "SmarterEveryDay",
    title: "A video",
    published: "2026-07-26T14:00:36+00:00",
    thumbnail: "https://i3.ytimg.com/vi/vS6HEes8daw/hqdefault.jpg",
    description: "",
    views: 1000,
    isShort: false,
    state: "new",
    seenAt: NOW.toISOString(),
    ...overrides,
  };
}

// ------------------------------------------------------------------- channel

test("a bare channel ID, and one buried in a URL, both parse", () => {
  assert.equal(parseChannelInput(`  ${CHANNEL} `), CHANNEL);
  assert.equal(parseChannelInput(`https://www.youtube.com/channel/${CHANNEL}/videos`), CHANNEL);
  assert.equal(parseChannelInput("https://www.youtube.com/@smartereveryday"), null);
});

test("a handle URL's channel ID comes out of the page HTML", () => {
  assert.equal(
    extractChannelIdFromHtml(`{"externalId":"${CHANNEL}","keywords":"x"}`),
    CHANNEL,
  );
  assert.equal(extractChannelIdFromHtml("nothing here"), null);
});

test("feed URL escapes what it interpolates", () => {
  assert.equal(
    feedUrl(CHANNEL),
    `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`,
  );
});

// ------------------------------------------------------------------- takeout

test("Takeout CSV: columns are found by name, not by position", () => {
  const csv = [
    "Channel Title,Channel Url,Channel Id",
    `SmarterEveryDay,https://www.youtube.com/channel/${CHANNEL},${CHANNEL}`,
  ].join("\n");
  assert.deepEqual(parseSubscriptionsCsv(csv), [{ id: CHANNEL, title: "SmarterEveryDay" }]);
});

test("Takeout CSV: a quoted title containing a comma stays one field", () => {
  const csv = [
    "Channel Id,Channel Url,Channel Title",
    `${CHANNEL},https://www.youtube.com/channel/${CHANNEL},"Wendover, Productions"`,
  ].join("\n");
  assert.deepEqual(parseSubscriptionsCsv(csv), [{ id: CHANNEL, title: "Wendover, Productions" }]);
});

// The exact column names were never verified against a real export, so an
// unrecognised header must not produce an empty import.
test("Takeout CSV: an unrecognised header still yields the channels", () => {
  const csv = [`identifiant,url,titre`, `${CHANNEL},https://x,Chaine`].join("\n");
  assert.deepEqual(parseSubscriptionsCsv(csv), [{ id: CHANNEL, title: CHANNEL }]);
});

test("Takeout CSV: duplicate rows collapse", () => {
  const csv = ["Channel Id,Channel Title", `${CHANNEL},A`, `${CHANNEL},B`].join("\n");
  assert.equal(parseSubscriptionsCsv(csv).length, 1);
});

test("re-importing the same export changes nothing", () => {
  const first = mergeChannels([], [{ id: CHANNEL, title: "SmarterEveryDay" }], NOW);
  assert.equal(first.added, 1);
  const second = mergeChannels(first.channels, [{ id: CHANNEL, title: "Renamed" }], NOW);
  assert.equal(second.added, 0);
  assert.deepEqual(second.channels, first.channels);
});

test("a channel missing from a newer export is not removed", () => {
  const existing = mergeChannels([], [{ id: CHANNEL, title: "A" }], NOW).channels;
  const merged = mergeChannels(existing, [], NOW);
  assert.equal(merged.channels.length, 1);
});

// ---------------------------------------------------------------------- feed

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
 <yt:channelId>${CHANNEL}</yt:channelId>
 <title>SmarterEveryDay</title>
 <entry>
  <yt:videoId>vS6HEes8daw</yt:videoId>
  <title>The PROBLEM with Capitalism</title>
  <published>2026-07-26T14:00:36+00:00</published>
  <media:group>
   <media:title>The PROBLEM with Capitalism</media:title>
   <media:thumbnail url="https://i3.ytimg.com/vi/vS6HEes8daw/hqdefault.jpg" width="480" height="360"/>
   <media:description>0:00 Intro
T&amp;C Metal Stamping &lt;here&gt;</media:description>
   <media:statistics views="677465"/>
  </media:group>
 </entry>
 <entry>
  <yt:videoId>abcdefghijk</yt:videoId>
  <title>Second</title>
  <published>2026-07-01T00:00:00+00:00</published>
  <media:group>
   <media:title>Second</media:title>
   <media:description></media:description>
  </media:group>
 </entry>
</feed>`;

test("the feed yields channel, entries, description and views", () => {
  const parsed = parseChannelFeed(FEED);
  assert.equal(parsed.channelId, CHANNEL);
  assert.equal(parsed.channelTitle, "SmarterEveryDay");
  assert.equal(parsed.entries.length, 2);

  const [first, second] = parsed.entries;
  assert.equal(first.videoId, "vS6HEes8daw");
  assert.equal(first.title, "The PROBLEM with Capitalism");
  assert.equal(first.published, "2026-07-26T14:00:36+00:00");
  assert.equal(first.views, 677465);
  assert.equal(first.thumbnail, "https://i3.ytimg.com/vi/vS6HEes8daw/hqdefault.jpg");
  // Entities decoded — the description is written into a note verbatim.
  assert.equal(first.description, "0:00 Intro\nT&C Metal Stamping <here>");

  assert.equal(second.views, null);
  assert.equal(second.thumbnail, "");
});

// Measured on a live feed: the header's own <yt:channelId> drops the UC prefix,
// while the same tag inside an entry keeps it. The self link is the honest one.
test("the channel ID survives the header's prefix-stripped copy", () => {
  const feed = `<feed>
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}"/>
 <yt:channelId>${CHANNEL.slice(2)}</yt:channelId>
 <title>SmarterEveryDay</title>
</feed>`;
  assert.equal(parseChannelFeed(feed).channelId, CHANNEL);
});

test("a feed with no entries parses rather than throwing", () => {
  const parsed = parseChannelFeed("<feed><title>Empty</title></feed>");
  assert.deepEqual(parsed.entries, []);
});

test("numeric and hex character references decode", () => {
  const parsed = parseChannelFeed(
    `<feed><entry><yt:videoId>aaaaaaaaaaa</yt:videoId><media:title>Caf&#233; &#x1F600;</media:title></entry></feed>`,
  );
  assert.equal(parsed.entries[0].title, "Café 😀");
});

// --------------------------------------------------------------------- merge

test("a known video is never rewritten by a later poll", () => {
  const kept = item({ state: "kept", description: "captured at poll time", notePath: "a.md" });
  const { items, added } = mergeItems(
    [kept],
    { id: CHANNEL, title: "SmarterEveryDay", addedAt: NOW.toISOString() },
    [
      {
        videoId: kept.videoId,
        title: "Retitled later",
        published: kept.published,
        thumbnail: "",
        description: "edited later",
        views: 99,
      },
    ],
    NOW,
  );
  assert.equal(added.length, 0);
  assert.deepEqual(items, [kept]);
});

test("a new video arrives as New with its description cached", () => {
  const { added } = mergeItems(
    [],
    { id: CHANNEL, title: "SmarterEveryDay", addedAt: NOW.toISOString() },
    [
      {
        videoId: "zzzzzzzzzzz",
        title: "Fresh",
        published: "2026-07-27T00:00:00Z",
        thumbnail: "t",
        description: "0:00 Intro",
        views: 5,
      },
    ],
    NOW,
  );
  assert.equal(added.length, 1);
  assert.equal(added[0].state, "new");
  assert.equal(added[0].description, "0:00 Intro");
  assert.equal(added[0].isShort, null);
});

// -------------------------------------------------------------------- expiry

test("New expires on age, Kept never does", () => {
  const old = "2026-01-01T00:00:00Z";
  const { items, removed } = expireItems(
    [item({ videoId: "aaaaaaaaaaa", published: old }), item({ videoId: "bbbbbbbbbbb", published: old, state: "kept" })],
    30,
    NOW,
  );
  assert.equal(removed, 1);
  assert.deepEqual(items.map((i) => i.videoId), ["bbbbbbbbbbb"]);
});

test("Dismissed expires immediately, whatever its age", () => {
  const { items } = expireItems([item({ state: "dismissed" })], 30, NOW);
  assert.deepEqual(items, []);
});

test("expiry of zero days is off, not instant", () => {
  const { items, removed } = expireItems([item({ published: "2020-01-01T00:00:00Z" })], 0, NOW);
  assert.equal(removed, 0);
  assert.equal(items.length, 1);
});

test("an unparseable publish date is kept rather than silently expired", () => {
  const { items } = expireItems([item({ published: "" })], 30, NOW);
  assert.equal(items.length, 1);
});

test("a searched-for item outlives a feed item of the same age", () => {
  const old = "2026-01-01T00:00:00Z";
  const { items, removed } = expireItems(
    [
      item({ videoId: "aaaaaaaaaaa", published: old, origin: "feed" }),
      item({ videoId: "bbbbbbbbbbb", published: old, origin: "search" }),
    ],
    30,
    NOW,
  );
  assert.equal(removed, 1);
  assert.deepEqual(items.map((i) => i.videoId), ["bbbbbbbbbbb"]);
});

test("dismissing a search item still removes it", () => {
  const { items } = expireItems([item({ origin: "search", state: "dismissed" })], 30, NOW);
  assert.deepEqual(items, []);
});

// -------------------------------------------------------------------- search

test("a search result becomes a New item with its description cached", () => {
  const result = {
    videoId: "vS6HEes8daw",
    title: "The PROBLEM with Capitalism",
    channelId: CHANNEL,
    channelTitle: "SmarterEveryDay",
    publishedText: "2 days ago",
    views: 1_353_645,
    duration: "55:31",
    thumbnail: "https://i.ytimg.com/vi_webp/vS6HEes8daw/mqdefault.webp",
  };
  const added = searchResultToItem(result, "0:00 Intro", NOW);
  assert.equal(added.state, "new");
  assert.equal(added.origin, "search");
  assert.equal(added.description, "0:00 Intro");
  assert.equal(added.views, 1_353_645);
  assert.equal(added.seenAt, NOW.toISOString());
  // No date is invented from "2 days ago": search states an age, not a date.
  assert.equal(added.published, "");
  assert.equal(added.isShort, null);
  assert.equal(added.notePath, undefined);
});

test("a search item with no description says so in its own words", () => {
  const note = buildWatchLaterNote(item({ description: "", origin: "search" }), NOW);
  assert.match(note, /_YouTube returned no description for this video\._/);
});

// ------------------------------------------------------------------ visible

test("the default view is New, newest first, Shorts hidden", () => {
  const items = [
    item({ videoId: "aaaaaaaaaaa", published: "2026-07-01T00:00:00Z" }),
    item({ videoId: "bbbbbbbbbbb", published: "2026-07-20T00:00:00Z" }),
    item({ videoId: "ccccccccccc", published: "2026-07-25T00:00:00Z", isShort: true }),
    item({ videoId: "ddddddddddd", published: "2026-07-26T00:00:00Z", state: "kept" }),
  ];
  const visible = visibleItems(items, { filter: "new", channelId: null, includeShorts: false });
  assert.deepEqual(visible.map((i) => i.videoId), ["bbbbbbbbbbb", "aaaaaaaaaaa"]);

  const withShorts = visibleItems(items, { filter: "new", channelId: null, includeShorts: true });
  assert.deepEqual(withShorts.map((i) => i.videoId), ["ccccccccccc", "bbbbbbbbbbb", "aaaaaaaaaaa"]);
});

test("All shows Kept too, but never Dismissed", () => {
  const items = [item({ videoId: "aaaaaaaaaaa", state: "kept" }), item({ videoId: "bbbbbbbbbbb", state: "dismissed" })];
  const visible = visibleItems(items, { filter: "all", channelId: null, includeShorts: false });
  assert.deepEqual(visible.map((i) => i.videoId), ["aaaaaaaaaaa"]);
});

test("an unprobed item is shown, not hidden as a suspected Short", () => {
  const visible = visibleItems([item({ isShort: null })], {
    filter: "new",
    channelId: null,
    includeShorts: false,
  });
  assert.equal(visible.length, 1);
});

test("the channel filter narrows to one channel", () => {
  const items = [item({ videoId: "aaaaaaaaaaa" }), item({ videoId: "bbbbbbbbbbb", channelId: "UCotherotherotherother" })];
  const visible = visibleItems(items, { filter: "new", channelId: CHANNEL, includeShorts: false });
  assert.deepEqual(visible.map((i) => i.videoId), ["aaaaaaaaaaa"]);
});

// ---------------------------------------------------------------------- note

test("the note carries the frontmatter the pinned player reads", () => {
  const note = buildWatchLaterNote(
    item({ title: 'Why "X": a talk', description: "0:00 Intro\n1:30 Middle", published: "2026-07-26T14:00:36Z" }),
    NOW,
  );
  assert.match(note, /^---\n/);
  assert.match(note, /title: "Why \\"X\\": a talk"\n/);
  assert.match(note, /media_link: https:\/\/www\.youtube\.com\/watch\?v=vS6HEes8daw\n/);
  assert.match(note, /published: 2026-07-26\n/);
  assert.match(note, /created: 2026-07-27\n/);
  assert.match(note, /^length: $/m);
  assert.match(note, /## Notes/);
  // Chapters are real links at creation time, so they survive the plugin being off.
  assert.match(note, /\[0:00\]\(ytfree:vS6HEes8daw:0\)/);
  assert.match(note, /\[1:30\]\(ytfree:vS6HEes8daw:90\)/);
});

test("a description-less video still produces a usable note", () => {
  const note = buildWatchLaterNote(item({ description: "" }), NOW);
  assert.match(note, /_No description in the channel feed\._/);
});

test("a title with no author writes no empty author entry", () => {
  const note = buildWatchLaterNote(item({ channelTitle: "" }), NOW);
  assert.match(note, /author:\npublished:/);
});

test("filenames drop the characters Obsidian and the OS choke on", () => {
  assert.equal(sanitizeFileName('a/b:c*d?e"f<g>h|i#j^k[l]m'), "a b c d e f g h i j k l m");
  assert.equal(sanitizeFileName("  spaced   out  "), "spaced out");
  assert.equal(sanitizeFileName("x".repeat(200)).length, 120);
});

// -------------------------------------------------------------------- format

test("relative age reads as a person would say it", () => {
  assert.equal(relativeAge("2026-07-27T11:59:30Z", NOW), "just now");
  assert.equal(relativeAge("2026-07-27T11:00:00Z", NOW), "1 hour ago");
  assert.equal(relativeAge("2026-07-25T12:00:00Z", NOW), "2 days ago");
  assert.equal(relativeAge("", NOW), "");
});

test("view counts shorten", () => {
  assert.equal(formatViews(677465), "677K views");
  assert.equal(formatViews(2_000_000), "2M views");
  assert.equal(formatViews(1_250_000), "1.3M views");
  assert.equal(formatViews(42), "42 views");
  assert.equal(formatViews(null), "");
});

// --------------------------------------------------------------------- state

test("a corrupt state file degrades to an empty hub", () => {
  assert.deepEqual(normalizeState(null).items, []);
  assert.deepEqual(normalizeState("garbage").channels, []);
  const partial = normalizeState({ channels: [{ id: "not-a-channel" }, { id: CHANNEL }], items: [{ videoId: "x" }] });
  assert.deepEqual(partial.channels.map((c) => c.id), [CHANNEL]);
  assert.deepEqual(partial.items, []);
});
