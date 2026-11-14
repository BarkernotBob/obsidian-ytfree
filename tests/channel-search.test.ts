import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  classifyAddChannelInput,
  parseChannelSearchResponse,
  resultButton,
  searchStatus,
} from "../src/channel-search.ts";
import { encodeChannelSearchParams } from "../src/search-params.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/channel-search-results-web.json", import.meta.url), "utf8"),
) as unknown;

test("the channel search is pinned to type = channel (youtube.com's sp=EgIQAg)", () => {
  assert.equal(encodeChannelSearchParams(), "EgIQAg");
});

test("the recorded WEB response parses into every channel, in order", () => {
  const results = parseChannelSearchResponse(fixture);
  assert.equal(results.length, 20);
  assert.deepEqual(results[0], {
    channelId: "UC6107grRI4m0o2-emgoDnAA",
    title: "SmarterEveryDay",
    handle: "@smartereveryday",
    subscribers: "11.9M subscribers",
    avatar: results[0].avatar,
  });
  assert.match(results[0].avatar, /^https:\/\//);
  assert.equal(new Set(results.map((r) => r.channelId)).size, 20);
});

test("a channel that hides its count has no subscriber line, and handles keep their accents", () => {
  const results = parseChannelSearchResponse(fixture);
  const hidden = results.find((r) => r.channelId === "UCjqyqV3OVriFo9wmrdOcW7Q");
  assert.ok(hidden);
  assert.equal(hidden.subscribers, "");
  assert.ok(results.some((r) => r.handle === "@JoéMoreau-SmarterEveryday"));
});

test("the handle falls back to the channel URL, decoded", () => {
  const raw = {
    contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
      { itemSectionRenderer: { contents: [
        { channelRenderer: {
          channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
          title: { simpleText: "A" },
          navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: "/@Jo%C3%A9" } },
        } },
        { channelRenderer: { channelId: "not-a-channel", title: { simpleText: "B" } } },
      ] } },
    ] } } } },
  };
  assert.deepEqual(parseChannelSearchResponse(raw), [
    { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "A", handle: "@Joé", subscribers: "", avatar: "" },
  ]);
});

test("an unexpected tree is no channels, never an exception", () => {
  for (const junk of [null, undefined, 1, "x", [], {}, { contents: { twoColumnSearchResultsRenderer: 5 } }]) {
    assert.deepEqual(parseChannelSearchResponse(junk), []);
  }
});

test("the box: links, IDs and @handles add directly; anything else searches", () => {
  assert.deepEqual(classifyAddChannelInput("   "), { kind: "empty" });
  assert.deepEqual(classifyAddChannelInput("@smartereveryday"), {
    kind: "link",
    value: "https://www.youtube.com/@smartereveryday",
  });
  assert.deepEqual(classifyAddChannelInput("https://www.youtube.com/@veritasium"), {
    kind: "link",
    value: "https://www.youtube.com/@veritasium",
  });
  assert.deepEqual(classifyAddChannelInput("UC6107grRI4m0o2-emgoDnAA"), {
    kind: "link",
    value: "UC6107grRI4m0o2-emgoDnAA",
  });
  assert.deepEqual(classifyAddChannelInput(" smarter every day "), { kind: "search", query: "smarter every day" });
  // Words around a domain are still a search; a youtu.be link is a video, not a channel.
  assert.deepEqual(classifyAddChannelInput("youtube.com tips"), { kind: "search", query: "youtube.com tips" });
  assert.equal(classifyAddChannelInput("https://youtu.be/dQw4w9WgXcQ").kind, "search");
});

test("a result's button: Subscribe, Subscribed ✓ (undoable), or already subscribed", () => {
  assert.deepEqual(
    [resultButton(false, false), resultButton(true, true), resultButton(true, false)].map((b) => [
      b.text,
      b.disabled,
      b.subscribed,
    ]),
    [
      ["Subscribe", false, false],
      ["Subscribed ✓", false, true],
      ["Subscribed ✓", true, true],
    ],
  );
});

test("the status line after a search", () => {
  assert.equal(searchStatus("zzz", 0), "No channels found for “zzz”.");
  assert.equal(searchStatus("a", 1), "1 channel for “a”. Tap Subscribe on each one you want.");
  assert.equal(searchStatus("a", 20), "20 channels for “a”. Tap Subscribe on each one you want.");
});

test("undoing a Subscribe in the sheet only unsubscribes; it is not the hub's Remove", () => {
  // removeChannel deletes the channel's undecided videos and syncs that deletion.
  // A one-tap undo must not (code review on #108).
  const hub = readFileSync(new URL("../src/hub.ts", import.meta.url), "utf8");
  const sheet = hub.slice(hub.indexOf("export class ImportSubscriptionsModal"), hub.indexOf("export class SearchBlocklistModal"));
  assert.ok(sheet.includes("undoSubscribe("));
  assert.ok(!sheet.includes("removeChannel("));
  const undo = hub.slice(hub.indexOf("  undoSubscribe(channelId: string)"), hub.indexOf("// ------------------------------------------------------ search blocklist"));
  assert.ok(undo.includes("unsubscribedChannels"));
  assert.ok(!undo.includes("items"));
});
