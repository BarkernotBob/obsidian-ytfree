import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MANAGE_EXPLAINER,
  TAKEOUT_STEPS,
  filterChannels,
  manageRowMeta,
  searchChannelMenu,
  subscribeButton,
  subscribedNotice,
  subscriptionsHeading,
  unsubscribedNotice,
  unsubscribedRow,
} from "../src/subscribe.ts";

/** Subscribing inside YT Free, and the Takeout steps (GitHub #65). */

test("the channel screen offers Subscribe, then shows Subscribed", () => {
  const before = subscribeButton(false);
  assert.equal(before.text, "Subscribe");
  assert.equal(before.disabled, false);
  assert.match(before.title, /Nothing is sent to YouTube/);
  const after = subscribeButton(true);
  assert.equal(after.text, "Subscribed ✓");
  // Tapping Subscribed unsubscribes now, so it is never disabled.
  assert.equal(after.disabled, false);
  assert.equal(after.subscribed, true);
  assert.match(after.title, /unsubscribe/);
});

test("a search card's menu offers Subscribe and Hide for a channel you don't follow", () => {
  assert.deepEqual(
    searchChannelMenu(false).map((item) => item.key),
    ["subscribe", "hide"],
  );
  // A channel you subscribe to cannot be hidden from search (047).
  assert.deepEqual(
    searchChannelMenu(true).map((item) => item.key),
    ["unsubscribe"],
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

/** Managing subscriptions (docs/V1-SCOPE-MANAGE-SUBSCRIPTIONS.md). */

test("the hub menu says Subscriptions with a count", () => {
  assert.equal(subscriptionsHeading(42), "Subscriptions · 42");
});

test("unsubscribing says what stops and what stays", () => {
  assert.match(MANAGE_EXPLAINER, /stops new videos/);
  assert.match(MANAGE_EXPLAINER, /Saved videos, notes and watch history stay/);
  assert.match(unsubscribedNotice("Veritasium"), /^Unsubscribed from Veritasium\. New videos stop; Saved videos and notes stay\.$/);
  assert.equal(unsubscribedRow("Veritasium"), "Unsubscribed from Veritasium");
  assert.equal(unsubscribedRow(""), "Unsubscribed from this channel");
});

test("a Manage row's line: new count, then last upload", () => {
  assert.equal(manageRowMeta(3, "2 days ago"), "3 new · last upload 2 days ago");
  assert.equal(manageRowMeta(0, "3 weeks ago"), "last upload 3 weeks ago");
  assert.equal(manageRowMeta(0, ""), "No videos checked yet");
});

test("the Manage filter matches every word, ignoring case and accents, sorted by name", () => {
  const channels = [{ title: "Veritasium" }, { title: "Ali Abdaal" }, { title: "Café Science" }];
  assert.deepEqual(filterChannels(channels, "").map((c) => c.title), ["Ali Abdaal", "Café Science", "Veritasium"]);
  assert.deepEqual(filterChannels(channels, "cafe").map((c) => c.title), ["Café Science"]);
  assert.deepEqual(filterChannels(channels, "ali ABD").map((c) => c.title), ["Ali Abdaal"]);
  assert.deepEqual(filterChannels(channels, "zzz"), []);
});

test("every way to unsubscribe goes through the one function with an Undo", () => {
  const hub = readFileSync("src/hub.ts", "utf8");
  const main = readFileSync("src/main.ts", "utf8");
  assert.ok(!hub.includes("removeChannel("), "the old remove path is gone");
  assert.ok(hub.includes("export function unsubscribeWithUndo("));
  assert.ok(main.includes("unsubscribeWithUndo(this.subscriptions"), "a note's channel row unsubscribes too");
});
