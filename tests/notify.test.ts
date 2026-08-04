/**
 * The two rules the Inbox notification lives or dies by.
 *
 * **One push per poll**, and **never twice for the same video**. Both are easy
 * to break by accident and impossible to notice until a phone has buzzed
 * fifteen times, so they are tested as scenarios here — "the Mac already sent
 * it", "the video was hidden while the feeds were in flight" — rather than as
 * assertions about fields.
 *
 * Nothing here touches the network. `sendNotification` takes its transport as
 * an argument precisely so that the failure paths can be proved without a
 * server to fail against, and so that running the suite never POSTs anywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HubItem, SubscriptionsState } from "../src/subscriptions.ts";
import { emptyState, hideItem, keepItem, mergeItems, mergeStates, normalizeState, restoreItem } from "../src/subscriptions.ts";
import type { NotificationSettings, PostRequest } from "../src/notify.ts";
import {
  NOTIFIED_LIMIT,
  buildPayload,
  buildRequest,
  describeTestOutcome,
  describeWebhook,
  isValidWebhook,
  mergeNotified,
  notificationMessage,
  notificationTitle,
  notificationsReady,
  pickNotifiable,
  rememberNotified,
  sendNotification,
  unclaimed,
  testPayload,
} from "../src/notify.ts";

const CHANNEL = "UC6107grRI4m0o2-emgoDnAA";
const NOW = new Date("2026-08-03T12:00:00.000Z");

function item(videoId: string, over: Partial<HubItem> = {}): HubItem {
  return {
    videoId,
    channelId: CHANNEL,
    channelTitle: "A channel",
    title: `Video ${videoId}`,
    published: "2026-08-01T00:00:00.000Z",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    description: "words",
    views: 100,
    isShort: false,
    state: "new",
    seenAt: "2026-08-01T00:00:00.000Z",
    origin: "feed",
    ...over,
  };
}

function settings(over: Partial<NotificationSettings> = {}): NotificationSettings {
  return { webhook: "https://ntfy.sh/topic", enabled: true, format: "json", ...over };
}

/** A transport that records instead of sending. Nothing leaves the process. */
function recorder(): { sent: PostRequest[]; post: (r: PostRequest) => Promise<void> } {
  const sent: PostRequest[] = [];
  return {
    sent,
    post: async (request) => {
      sent.push(request);
    },
  };
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ------------------------------------------------------------------ batching

test("a poll that adds fifteen videos produces one payload, not fifteen", () => {
  const added = Array.from({ length: 15 }, (_, i) => item(`vid${String(i).padStart(7, "0")}`));
  const picked = pickNotifiable(added, added, []);
  assert.equal(picked.length, 15);

  const payload = buildPayload(picked, NOW);
  assert.equal(payload.count, 15);
  assert.equal(payload.videos.length, 15);
  // One object goes over the wire, and it is one string.
  assert.equal(typeof buildRequest(payload, "json").body, "string");
});

test("one poll is one POST even with fifteen new videos", async () => {
  const added = Array.from({ length: 15 }, (_, i) => item(`vid${String(i).padStart(7, "0")}`));
  const { sent, post } = recorder();
  await sendNotification(settings(), buildPayload(added, NOW), post);
  assert.equal(sent.length, 1);
});

test("a poll that adds nothing has nothing to send", async () => {
  const picked = pickNotifiable([], [item("aaaaaaaaaaa")], []);
  assert.deepEqual(picked, []);

  const { sent, post } = recorder();
  const outcome = await sendNotification(settings(), buildPayload(picked, NOW), post);
  assert.equal(outcome.ok, false);
  assert.equal(sent.length, 0);
});

test("the message names one video, lists a few, and counts a burst", () => {
  const one = buildPayload([item("aaaaaaaaaaa", { title: "The One" })], NOW);
  assert.match(one.message, /The One/);
  assert.equal(one.title, notificationTitle(1));
  assert.match(one.title, /1 new video$/);

  const three = buildPayload(
    ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id) => item(id)),
    NOW,
  );
  assert.equal(three.message.split("\n").length, 3);

  const many = buildPayload(
    Array.from({ length: 12 }, (_, i) =>
      item(`vid${String(i).padStart(7, "0")}`, { channelTitle: `Channel ${i % 5}` }),
    ),
    NOW,
  );
  // Twelve titles is a document, not a notification.
  assert.match(many.message, /^12 new videos from /);
  assert.match(many.title, /12 new videos$/);
  assert.equal(many.channels.length, 5);
});

test("the payload carries the ids and the URLs, not just a sentence", () => {
  const payload = buildPayload([item("aaaaaaaaaaa")], NOW);
  assert.equal(payload.videos[0].videoId, "aaaaaaaaaaa");
  assert.equal(payload.videos[0].url, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  assert.equal(payload.event, "ytfree.inbox");
  assert.equal(payload.sentAt, NOW.toISOString());
});

// -------------------------------------------------------------------- dedupe

test("a video already notified about is never notified about again", () => {
  const videos = [item("aaaaaaaaaaa"), item("bbbbbbbbbbb")];
  const notified = rememberNotified([], ["aaaaaaaaaaa"], NOW);
  const picked = pickNotifiable(videos, videos, notified);
  assert.deepEqual(picked.map((v) => v.videoId), ["bbbbbbbbbbb"]);
});

test("the next poll re-offering the same video sends nothing", () => {
  const videos = [item("aaaaaaaaaaa")];
  let notified = rememberNotified([], ["aaaaaaaaaaa"], NOW);
  // The feed still holds it — a 15-entry window keeps a video around for days.
  const again = pickNotifiable(videos, videos, notified);
  assert.deepEqual(again, []);
  notified = rememberNotified(notified, again.map((v) => v.videoId), NOW);
  assert.equal(notified.length, 1);
});

test("mergeItems never re-offers a video the index already holds", () => {
  const existing = [item("aaaaaaaaaaa")];
  const channel = { id: CHANNEL, title: "A channel", addedAt: "2026-07-01T00:00:00.000Z" };
  const entries = [
    {
      videoId: "aaaaaaaaaaa",
      title: "Video aaaaaaaaaaa",
      published: "2026-08-01T00:00:00.000Z",
      thumbnail: "",
      description: "",
      views: null,
    },
  ];
  const merged = mergeItems(existing, channel, entries, NOW);
  // This is the first line of defence: opened, hidden and restored videos are
  // all in `existing`, so none of them ever reaches `pickNotifiable`.
  assert.deepEqual(merged.added, []);
});

test("a video hidden while the feeds were in flight is not announced", () => {
  const added = [item("aaaaaaaaaaa"), item("bbbbbbbbbbb")];
  const live = copy(added);
  hideItem(live[0], NOW);
  const picked = pickNotifiable(added, live, []);
  assert.deepEqual(picked.map((v) => v.videoId), ["bbbbbbbbbbb"]);
});

test("a video opened on the other device mid-poll is not announced", () => {
  const added = [item("aaaaaaaaaaa")];
  const live = copy(added);
  keepItem(live[0], "Watch Later/Video.md", NOW);
  assert.deepEqual(pickNotifiable(added, live, []), []);
});

test("a video the poll expired out from under itself is not announced", () => {
  const added = [item("aaaaaaaaaaa")];
  // `expireItems` runs after the feeds land, and can drop what a feed just gave
  // us. Nothing is in the Inbox to point at, so nothing is said.
  assert.deepEqual(pickNotifiable(added, [], []), []);
});

test("restoring a hidden video does not fire a notification", () => {
  // Restore does not go through `mergeItems`, so a restored video is never in
  // `added` at all — and even if it were, it has already been notified about.
  const restored = item("aaaaaaaaaaa", { state: "dismissed", dismissedAt: NOW.toISOString() });
  restoreItem(restored, NOW);
  const notified = rememberNotified([], ["aaaaaaaaaaa"], NOW);
  assert.deepEqual(pickNotifiable([restored], [restored], notified), []);
});

test("the same video arriving twice in one poll is announced once", () => {
  // Two channels can carry the same video — a collaboration, or a re-upload
  // picked up by both feeds inside the same run.
  const dupe = [item("aaaaaaaaaaa"), item("aaaaaaaaaaa", { channelTitle: "Another channel" })];
  const picked = pickNotifiable(dupe, [dupe[0]], []);
  assert.equal(picked.length, 1);
});

test("watched videos are skipped unless the Inbox is showing them", () => {
  const added = [item("aaaaaaaaaaa", { watched: true }), item("bbbbbbbbbbb")];
  assert.deepEqual(
    pickNotifiable(added, added, []).map((v) => v.videoId),
    ["bbbbbbbbbbb"],
  );
  assert.equal(pickNotifiable(added, added, [], { showWatched: true }).length, 2);
});

test("Shorts are skipped unless Shorts are included, and an unprobed video is not a Short", () => {
  const added = [
    item("aaaaaaaaaaa", { isShort: true }),
    item("bbbbbbbbbbb", { isShort: null }),
    item("ccccccccccc", { isShort: false }),
  ];
  assert.deepEqual(
    pickNotifiable(added, added, []).map((v) => v.videoId),
    ["bbbbbbbbbbb", "ccccccccccc"],
  );
  assert.equal(pickNotifiable(added, added, [], { includeShorts: true }).length, 3);
});

// ------------------------------------------------------- dedupe across devices

test("the phone does not re-announce what the Mac already sent", () => {
  // The Mac polled, claimed and sent a minute ago. Its claim is on disk.
  const onDisk = rememberNotified([], ["aaaaaaaaaaa"], NOW);

  // The phone polls with a copy that predates the Mac's write, so its own
  // `mergeItems` hands it the same video as new, and it claims it too.
  const added = [item("aaaaaaaaaaa"), item("bbbbbbbbbbb")];
  const candidates = pickNotifiable(added, added, []);
  assert.equal(candidates.length, 2);

  // Then it saves. The save is a merge, and what it hands back is the file as
  // it stood *before* the merge — which is where the phone learns it was second.
  const mine = unclaimed(candidates, onDisk);
  assert.deepEqual(mine.map((v) => v.videoId), ["bbbbbbbbbbb"]);
});

test("a device with nothing on disk to compare against sends everything it claimed", () => {
  const added = [item("aaaaaaaaaaa")];
  assert.equal(unclaimed(pickNotifiable(added, added, []), []).length, 1);
});

test("both devices claiming the same whole poll means exactly one of them sends", () => {
  const added = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id) => item(id));
  const macSent = pickNotifiable(added, added, []);
  const onDisk = rememberNotified([], macSent.map((v) => v.videoId), NOW);
  // The phone finds the same three and is left with none.
  assert.deepEqual(unclaimed(pickNotifiable(added, added, []), onDisk), []);
});

test("a claim survives merging with a device that never heard of it", () => {
  const mine = { ...emptyState(), notifiedVideos: [{ id: "aaaaaaaaaaa", at: NOW.toISOString() }] };
  const theirs = emptyState();
  const merged = mergeStates(copy(mine), copy(theirs));
  assert.deepEqual(merged.notifiedVideos, [{ id: "aaaaaaaaaaa", at: NOW.toISOString() }]);

  // And in the other direction, and across a second round trip.
  const back = mergeStates(copy(theirs), copy(merged));
  assert.deepEqual(back.notifiedVideos?.map((e) => e.id), ["aaaaaaaaaaa"]);
});

test("two devices' claims are unioned, and the earlier stamp is the true one", () => {
  const early = "2026-08-03T12:00:00.000Z";
  const late = "2026-08-03T12:05:00.000Z";
  const merged = mergeNotified(
    [{ id: "aaaaaaaaaaa", at: late }, { id: "bbbbbbbbbbb", at: late }],
    [{ id: "aaaaaaaaaaa", at: early }, { id: "ccccccccccc", at: early }],
  );
  assert.deepEqual(
    merged.map((e) => e.id).sort(),
    ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"],
  );
  // The push went out at the earlier moment; the later record is the copy.
  assert.equal(merged.find((e) => e.id === "aaaaaaaaaaa")?.at, early);
});

test("a claim is not lost when the video is deleted and added back", () => {
  // `deletedVideos` is pruned against the live list; `notifiedVideos` is not.
  // A video you have been told about stays told about.
  const state: SubscriptionsState = {
    ...emptyState(),
    items: [item("aaaaaaaaaaa")],
    notifiedVideos: [{ id: "aaaaaaaaaaa", at: NOW.toISOString() }],
  };
  const merged = mergeStates(copy(state), copy(state));
  assert.equal(merged.notifiedVideos?.length, 1);
});

test("re-claiming a video keeps the first stamp", () => {
  const first = rememberNotified([], ["aaaaaaaaaaa"], NOW);
  const second = rememberNotified(first, ["aaaaaaaaaaa"], new Date("2026-08-04T12:00:00.000Z"));
  assert.equal(second.length, 1);
  assert.equal(second[0].at, NOW.toISOString());
});

test("the claim list is capped, oldest off the end", () => {
  const ids = Array.from({ length: NOTIFIED_LIMIT + 20 }, (_, i) => `v${i}`);
  let notified: Array<{ id: string; at: string }> = [];
  for (const [i, id] of ids.entries()) {
    notified = rememberNotified(notified, [id], new Date(NOW.getTime() + i * 1000));
  }
  assert.equal(notified.length, NOTIFIED_LIMIT);
  assert.equal(notified.some((e) => e.id === "v0"), false);
  assert.equal(notified.some((e) => e.id === ids[ids.length - 1]), true);
  // And the cap holds through a merge, so two devices cannot grow it together.
  assert.equal(mergeNotified(notified, notified).length, NOTIFIED_LIMIT);
});

test("a state file written before this feature existed reads as no claims", () => {
  const legacy = normalizeState({ version: 1, channels: [], items: [], lastPolledAt: null });
  assert.deepEqual(legacy.notifiedVideos, []);
  // And rubbish in the field does not take the plugin down with it.
  const junk = normalizeState({ notifiedVideos: [null, 3, { id: "aaaaaaaaaaa", at: "x" }, { id: 1 }] });
  assert.deepEqual(junk.notifiedVideos, [{ id: "aaaaaaaaaaa", at: "x" }]);
});

// ---------------------------------------------------------- off by default

test("an empty webhook is off, and nothing is ever sent", async () => {
  const off = settings({ webhook: "" });
  assert.equal(notificationsReady(off), false);

  const { sent, post } = recorder();
  const outcome = await sendNotification(off, buildPayload([item("aaaaaaaaaaa")], NOW), post);
  assert.deepEqual(outcome, { ok: false, reason: "disabled" });
  assert.equal(sent.length, 0);
});

test("the toggle pauses without the URL being deleted", async () => {
  const paused = settings({ enabled: false });
  const { sent, post } = recorder();
  await sendNotification(paused, buildPayload([item("aaaaaaaaaaa")], NOW), post);
  assert.equal(sent.length, 0);
  assert.equal(paused.webhook, "https://ntfy.sh/topic");
});

test("only http and https URLs are accepted", () => {
  assert.equal(isValidWebhook("https://ntfy.sh/abc"), true);
  assert.equal(isValidWebhook("http://192.168.1.4:8080/hook"), true);
  assert.equal(isValidWebhook("  https://ntfy.sh/abc  "), true);
  assert.equal(isValidWebhook("file:///etc/passwd"), false);
  assert.equal(isValidWebhook("obsidian://open"), false);
  assert.equal(isValidWebhook("ntfy.sh/abc"), false);
  assert.equal(isValidWebhook(""), false);
});

// ------------------------------------------------------------ failing quietly

test("a webhook that throws does not throw at the poll", async () => {
  const outcome = await sendNotification(settings(), buildPayload([item("aaaaaaaaaaa")], NOW), async () => {
    throw new Error("500 Internal Server Error");
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.reason, "failed");
  assert.equal(outcome.ok === false && outcome.error, "500 Internal Server Error");
});

test("a webhook that never resolves a host is the same kind of nothing", async () => {
  const outcome = await sendNotification(settings(), buildPayload([item("aaaaaaaaaaa")], NOW), async () => {
    throw new Error("net::ERR_NAME_NOT_RESOLVED");
  });
  assert.equal(outcome.ok, false);
  // No rethrow, no rejection: `await`ing this in a poll's `finally` is safe.
});

test("a thrown non-Error is still reported as words", async () => {
  const outcome = await sendNotification(settings(), buildPayload([item("aaaaaaaaaaa")], NOW), async () => {
    throw "just a string";
  });
  assert.equal(outcome.ok === false && outcome.error, "just a string");
});

// ------------------------------------------------------------------- the wire

test("JSON is the body; text is the sentence on its own", () => {
  const payload = buildPayload([item("aaaaaaaaaaa", { title: "The One" })], NOW);

  const json = buildRequest(payload, "json");
  assert.equal(json.contentType, "application/json");
  assert.deepEqual(JSON.parse(json.body).videos[0].videoId, "aaaaaaaaaaa");

  const text = buildRequest(payload, "text");
  assert.equal(text.contentType, "text/plain");
  assert.equal(text.body, payload.message);
  // ntfy reads this header and puts it above the body.
  assert.equal(text.headers.Title, payload.title);
});

test("the URL is trimmed before it is used", async () => {
  const { sent, post } = recorder();
  await sendNotification(
    settings({ webhook: "  https://ntfy.sh/topic  " }),
    buildPayload([item("aaaaaaaaaaa")], NOW),
    post,
  );
  assert.equal(sent[0].url, "https://ntfy.sh/topic");
});

test("the test notification is a real send with obviously fake contents", async () => {
  const { sent, post } = recorder();
  const outcome = await sendNotification(settings(), testPayload(NOW), post);
  assert.equal(outcome.ok, true);
  assert.equal(sent.length, 1);
  assert.match(JSON.parse(sent[0].body).title, /test/i);
  assert.equal(JSON.parse(sent[0].body).count, 0);
});

// -------------------------------------------------------------- what it says

test("the status line says the consequence, not the state", () => {
  assert.match(describeWebhook(settings({ webhook: "" })), /no messages will be sent/i);
  assert.match(describeWebhook(settings({ webhook: "nonsense" })), /http/i);
  assert.match(describeWebhook(settings({ enabled: false })), /paused/i);
  assert.match(describeWebhook(settings()), /^Ready/);
});

test("the test button reports what happened, including the failure", () => {
  assert.match(describeTestOutcome({ ok: true }), /^Sent/);
  assert.match(describeTestOutcome({ ok: false, reason: "disabled" }), /turn Send notifications on/);
  assert.match(describeTestOutcome({ ok: false, reason: "failed", error: "503" }), /503/);
});

test("the empty message is never sent as a notification", () => {
  assert.equal(notificationMessage([]), "");
});
