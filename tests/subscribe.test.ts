import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  TAKEOUT_STEPS,
  searchChannelMenu,
  subscribeButton,
  subscribedNotice,
} from "../src/subscribe.ts";

/** Subscribing inside YT Free, and the Takeout steps (GitHub #65). */

test("the channel screen offers Subscribe, then shows Subscribed", () => {
  const before = subscribeButton(false);
  assert.equal(before.text, "Subscribe");
  assert.equal(before.disabled, false);
  assert.match(before.title, /Nothing is sent to YouTube/);
  const after = subscribeButton(true);
  assert.equal(after.text, "Subscribed");
  assert.equal(after.disabled, true);
});

test("a search card's menu offers Subscribe and Hide for a channel you don't follow", () => {
  assert.deepEqual(
    searchChannelMenu(false).map((item) => item.key),
    ["subscribe", "hide"],
  );
  // A channel you subscribe to cannot be hidden from search (047).
  assert.deepEqual(
    searchChannelMenu(true).map((item) => item.key),
    ["subscribed"],
  );
});

test("the notice names the channel and says when its videos arrive", () => {
  assert.match(subscribedNotice("Ward on Words"), /subscribed to Ward on Words.*next check/);
  assert.match(subscribedNotice(""), /this channel/);
});

test("the Takeout steps export only subscriptions and end at subscriptions.csv", () => {
  const text = TAKEOUT_STEPS.join("\n");
  assert.ok(TAKEOUT_STEPS[0].includes("takeout.google.com"));
  assert.match(text, /Deselect all/);
  assert.match(text, /YouTube and YouTube Music/);
  assert.match(text, /only “subscriptions”/);
  assert.match(text, /subscriptions\.csv/);
});

test("no Subscribe opens youtube.com any more", () => {
  const hub = readFileSync("src/hub.ts", "utf8");
  assert.ok(!hub.includes("channelUrl("), "hub.ts sends Subscribe to youtube.com");
  assert.ok(hub.includes("subscribeToChannel("));
});
