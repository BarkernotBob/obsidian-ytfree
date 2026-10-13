/**
 * Collabs from the subscription feed (GitHub #2).
 *
 * The feed rows are in the shape `PRINT_TEMPLATE` prints, and the first one is
 * the real row from Isaiah's feed on 2026-10-13: the RBN upload with Ward on
 * Words as collaborator, 145th of 800 entries.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLLAB_FEED_FIRST_LIMIT,
  collabsFromSubsFeed,
  parsePrintRows,
} from "../src/account.ts";
import type { HubItem } from "../src/subscriptions.ts";
import { deskSub, expireItems, phoneSubParts } from "../src/subscriptions.ts";

const WARD = "UCKRmL7BMyCeLE4KUo73RDzw";
const RBN = "UCq_gchqc7P-tOiRNlzCHkkw";
const OTHER = "UC4vV6hVO83FLDmNzBiEiuPw";
const now = new Date("2026-10-13T12:00:00Z");

const feed = parsePrintRows(
  [
    `-X4ZD3fisSs\tNetTalk: The Pastor's Use of AI with Mark Ward\t${RBN}\tReformed Baptist Network`,
    `Z4Ql-1GnK0g\tLament vs. Complaint\t${WARD}\tWard on Words`,
    `aaaaaaaaaaa\tFrom a channel you dropped\t${OTHER}\tSomeone`,
    `bbbbbbbbbbb\tNo channel id\tNA\tNA`,
  ].join("\n"),
);

function item(videoId: string, channelId = WARD): HubItem {
  return {
    videoId,
    channelId,
    channelTitle: "",
    title: videoId,
    published: "",
    thumbnail: "",
    description: "",
    views: null,
    isShort: null,
    state: "new",
    seenAt: now.toISOString(),
  };
}

const base = { items: [] as HubItem[], channels: [{ id: WARD }] };

test("a video from a channel the hub does not poll comes in as a collab", () => {
  const added = collabsFromSubsFeed(base, feed, now);
  const ids = added.map((entry) => entry.videoId);
  assert.ok(ids.includes("-X4ZD3fisSs"));
  const collab = added.find((entry) => entry.videoId === "-X4ZD3fisSs");
  assert.equal(collab?.origin, "collab");
  // The uploader's name: what the feed reports, and what Delete and Hide key on.
  assert.equal(collab?.channelId, RBN);
  assert.equal(collab?.channelTitle, "Reformed Baptist Network");
  assert.equal(collab?.state, "new");
  assert.equal(collab?.published, "");
});

test("a subscribed channel's own upload is left to its RSS feed", () => {
  const ids = collabsFromSubsFeed(base, feed, now).map((entry) => entry.videoId);
  assert.ok(!ids.includes("Z4Ql-1GnK0g"));
});

test("a row without a channel id is not guessed at", () => {
  const ids = collabsFromSubsFeed(base, feed, now).map((entry) => entry.videoId);
  assert.ok(!ids.includes("bbbbbbbbbbb"));
});

test("a channel removed in the hub or unsubscribed on YouTube cannot come back this way", () => {
  for (const key of ["removedChannels", "unsubscribedChannels"] as const) {
    const ids = collabsFromSubsFeed({ ...base, [key]: [{ id: OTHER }] }, feed, now).map(
      (entry) => entry.videoId,
    );
    assert.ok(!ids.includes("aaaaaaaaaaa"), key);
    assert.ok(ids.includes("-X4ZD3fisSs"), key);
  }
});

test("a video already in the hub, hidden, or deleted stays as it is", () => {
  const hidden = { ...item("-X4ZD3fisSs", RBN), state: "dismissed" as const };
  assert.deepEqual(collabsFromSubsFeed({ ...base, items: [hidden] }, feed, now).map((e) => e.videoId), [
    "aaaaaaaaaaa",
  ]);
  const deleted = { ...base, deletedVideos: [{ id: "-X4ZD3fisSs" }] };
  assert.ok(!collabsFromSubsFeed(deleted, feed, now).some((e) => e.videoId === "-X4ZD3fisSs"));
});

test("the same video twice in one feed is added once", () => {
  const twice = [...feed, ...feed];
  const added = collabsFromSubsFeed(base, twice, now);
  assert.equal(added.filter((e) => e.videoId === "-X4ZD3fisSs").length, 1);
});

test("the first deep read reaches as far as the collab that started #2", () => {
  assert.ok(COLLAB_FEED_FIRST_LIMIT >= 145);
});

test("a collab says where it came from, and ages from when it arrived", () => {
  const collab = collabsFromSubsFeed(base, feed, now)[0];
  assert.match(deskSub(collab, now), /Collab/);
  assert.equal(phoneSubParts(collab, now).trailing, "Collab");
  const later = new Date(now.getTime() + 31 * 86_400_000);
  assert.equal(expireItems([collab], 30, later).items.length, 0);
  assert.equal(expireItems([collab], 30, now).items.length, 1);
});
