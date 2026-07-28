import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWatched,
  channelsFromChannelsPage,
  channelsFromSubsFeed,
  describeSession,
  emptySession,
  hasCompleteSession,
  looksLikeExpiry,
  mergeWatchLater,
  missingAuthCookies,
  parsePrintRows,
  syncIsDue,
  toNetscape,
  videoIdsFrom,
} from "../src/account.ts";
import { resolveCookieFile } from "../src/desktop/account.ts";
import type { AccountSession } from "../src/account.ts";
import type { HubItem } from "../src/subscriptions.ts";
import { visibleItems } from "../src/subscriptions.ts";

const NOW = new Date("2026-07-28T12:00:00Z");
const CHANNEL = "UC6107grRI4m0o2-emgoDnAA";

function item(overrides: Partial<HubItem> = {}): HubItem {
  return {
    videoId: "abcdefghijk",
    channelId: CHANNEL,
    channelTitle: "A Channel",
    title: "A Video",
    published: "2026-07-27T12:00:00Z",
    thumbnail: "",
    description: "",
    views: null,
    isShort: null,
    state: "new",
    seenAt: "2026-07-27T12:00:00Z",
    ...overrides,
  };
}

const FULL_SESSION = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "LOGIN_INFO",
].map((name) => ({ name, value: "x", domain: ".google.com" }));

// ----------------------------------------------------------------- cookies

test("a session is complete only when every auth cookie is present", () => {
  assert.equal(hasCompleteSession(FULL_SESSION), true);
  const partial = FULL_SESSION.slice(0, 3);
  assert.equal(hasCompleteSession(partial), false);
  assert.deepEqual(missingAuthCookies(partial), [
    "APISID",
    "SAPISID",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "LOGIN_INFO",
  ]);
});

test("netscape output is tab-separated with dotted domains", () => {
  const text = toNetscape([
    {
      name: "SID",
      value: "abc",
      domain: "youtube.com",
      path: "/",
      secure: true,
      expirationDate: 1800000000.5,
    },
  ]);
  const row = text.trim().split("\n").pop() as string;
  assert.deepEqual(row.split("\t"), [
    ".youtube.com",
    "TRUE",
    "/",
    "TRUE",
    "1800000000",
    "SID",
    "abc",
  ]);
});

test("a session cookie is written with a zero expiry, not NaN", () => {
  const row = toNetscape([{ name: "LOGIN_INFO", value: "v", domain: ".youtube.com", session: true }])
    .trim()
    .split("\n")
    .pop() as string;
  assert.equal(row.split("\t")[4], "0");
});

test("a blank cookie path falls back to the default location", () => {
  assert.match(resolveCookieFile(""), /obsidian-ytfree\/cookies\.txt$/);
  assert.equal(resolveCookieFile("/tmp/c.txt"), "/tmp/c.txt");
  assert.match(resolveCookieFile("~/c.txt"), /^\/.*\/c\.txt$/);
});

// ------------------------------------------------------------------ yt-dlp

test("print rows tolerate NA fields and blank lines", () => {
  const rows = parsePrintRows(
    ["abcdefghijk\tA Video\t" + CHANNEL + "\tA Channel", "", "lmnopqrstuv\tNA\tNA\tNA"].join("\n"),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: "abcdefghijk",
    title: "A Video",
    channelId: CHANNEL,
    channelTitle: "A Channel",
  });
  assert.deepEqual(rows[1], { id: "lmnopqrstuv", title: null, channelId: null, channelTitle: null });
});

test("the subscription manager gives channels directly; the feed gives them via videos", () => {
  const page = channelsFromChannelsPage(
    parsePrintRows(`${CHANNEL}\tA Channel\tNA\tNA\nnot-a-channel\tJunk\tNA\tNA`),
  );
  assert.deepEqual(page, [{ id: CHANNEL, title: "A Channel" }]);

  const feed = channelsFromSubsFeed(
    parsePrintRows(
      `abcdefghijk\tOne\t${CHANNEL}\tA Channel\nlmnopqrstuv\tTwo\t${CHANNEL}\tA Channel`,
    ),
  );
  assert.deepEqual(feed, [{ id: CHANNEL, title: "A Channel" }]);
});

test("history ids are de-duplicated and keep their order", () => {
  const ids = videoIdsFrom(
    parsePrintRows("aaaaaaaaaaa\tA\tNA\tNA\nbbbbbbbbbbb\tB\tNA\tNA\naaaaaaaaaaa\tA\tNA\tNA"),
  );
  assert.deepEqual(ids, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
});

// ------------------------------------------------------------------- merge

test("watch later adds what is new and never rewrites what is known", () => {
  const existing = [item({ videoId: "abcdefghijk", title: "From the feed", state: "kept" })];
  const { items, added } = mergeWatchLater(
    existing,
    parsePrintRows(
      `abcdefghijk\tRenamed on YouTube\t${CHANNEL}\tA Channel\nlmnopqrstuv\tNew one\t${CHANNEL}\tA Channel`,
    ),
    NOW,
  );

  assert.equal(added, 1);
  const known = items.find((i) => i.videoId === "abcdefghijk") as HubItem;
  assert.equal(known.title, "From the feed", "the cached title stands");
  assert.equal(known.state, "kept");
  assert.equal(known.origin, "both");

  const fresh = items.find((i) => i.videoId === "lmnopqrstuv") as HubItem;
  assert.equal(fresh.origin, "watchlater");
  assert.equal(fresh.published, "", "flat mode carries no publish date");
  assert.equal(fresh.state, "new");
});

test("watch later is idempotent", () => {
  const rows = parsePrintRows(`lmnopqrstuv\tOne\t${CHANNEL}\tA Channel`);
  const first = mergeWatchLater([], rows, NOW);
  const second = mergeWatchLater(first.items, rows, NOW);
  assert.equal(second.added, 0);
  assert.equal(second.items.length, 1);
});

test("watched marks only what history names, and only once", () => {
  const items = [item({ videoId: "aaaaaaaaaaa" }), item({ videoId: "bbbbbbbbbbb" })];
  assert.equal(applyWatched(items, ["aaaaaaaaaaa", "zzzzzzzzzzz"]), 1);
  assert.equal(items[0].watched, true);
  assert.equal(items[1].watched, undefined);
  assert.equal(applyWatched(items, ["aaaaaaaaaaa"]), 0);
});

test("watched items drop out of New but stay in All and Kept", () => {
  const items = [item({ videoId: "aaaaaaaaaaa", watched: true }), item({ videoId: "bbbbbbbbbbb" })];
  const options = { channelId: null, includeShorts: true };

  const hidden = visibleItems(items, { ...options, filter: "new", showWatched: false });
  assert.deepEqual(hidden.map((i) => i.videoId), ["bbbbbbbbbbb"]);

  const shown = visibleItems(items, { ...options, filter: "new", showWatched: true });
  assert.equal(shown.length, 2);

  const all = visibleItems(items, { ...options, filter: "all", showWatched: false });
  assert.equal(all.length, 2, "All never withholds anything");
});

// ----------------------------------------------------------------- session

test("the status line says what state the session is in", () => {
  assert.equal(describeSession(emptySession(), NOW), "Not signed in.");

  const signedIn: AccountSession = {
    status: "signed-in",
    name: "BarkernotBob",
    lastSyncAt: null,
    lastError: null,
  };
  assert.equal(describeSession(signedIn, NOW), "Signed in as BarkernotBob. Not synced yet.");
  assert.equal(
    describeSession({ ...signedIn, lastSyncAt: "2026-07-28T09:00:00Z" }, NOW),
    "Signed in as BarkernotBob. Synced 3 hours ago.",
  );
  assert.equal(
    describeSession({ ...signedIn, name: null, lastSyncAt: "2026-07-28T11:59:40Z" }, NOW),
    "Signed in. Synced just now.",
  );
  assert.match(describeSession({ ...signedIn, status: "expired" }, NOW), /^Session expired/);
});

test("a sync is due only when signed in and the gap has passed", () => {
  const session: AccountSession = {
    status: "signed-in",
    name: null,
    lastSyncAt: "2026-07-28T00:00:00Z",
    lastError: null,
  };
  assert.equal(syncIsDue(session, 12, NOW), true);
  assert.equal(syncIsDue(session, 24, NOW), false);
  assert.equal(syncIsDue({ ...session, lastSyncAt: null }, 12, NOW), true);
  assert.equal(syncIsDue({ ...session, status: "expired" }, 1, NOW), false);
  assert.equal(syncIsDue({ ...session, status: "signed-out" }, 1, NOW), false);
});

test("only an auth failure counts as expiry — a timeout is not a sign-out", () => {
  assert.equal(
    looksLikeExpiry("ERROR: [youtube:tab] Login details are needed to download this content"),
    true,
  );
  assert.equal(looksLikeExpiry("Sign in to confirm you're not a bot"), true);
  assert.equal(looksLikeExpiry("HTTP Error 403: Forbidden"), true);
  assert.equal(looksLikeExpiry("Unable to download API page: The read operation timed out"), false);
  assert.equal(looksLikeExpiry("getaddrinfo ENOTFOUND www.youtube.com"), false);
});
