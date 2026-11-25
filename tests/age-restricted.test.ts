/**
 * Age-restricted videos are blocked everywhere (#111,
 * `docs/V1-SCOPE-AGE-RESTRICTED.md`): what counts as an age gate, the request
 * flags that ask YouTube to leave them out, and the synced list that hides
 * them from every list and from notifications.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_BLOCKED_MESSAGE,
  AgeRestrictedError,
  isAdultAgeLimit,
  isAgeGatePlayability,
  isAgeGatedAnswer,
  isAgeRestricted,
  onAgeRestricted,
  reportAgeRestricted,
} from "../src/age-restricted.ts";
import { CLIENTS, playerBody, requestContext } from "../src/innertube-context.ts";
import { playabilityFailure } from "../src/mobile/player-response.ts";
import { endsTierWalk } from "../src/play-provider.ts";
import { setBlocked } from "../src/search-blocklist.ts";
import type { HubItem } from "../src/subscriptions.ts";
import { emptyState, mergeItems, mergeStates, normalizeState, visibleItems } from "../src/subscriptions.ts";
import { pickNotifiable } from "../src/notify.ts";
import { AGE_LIMIT_PREFIX, buildArgs, downloadVideo } from "../src/desktop/download.ts";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHANNEL = "UCaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-11-13T00:00:00.000Z");

function item(videoId: string, over: Partial<HubItem> = {}): HubItem {
  return {
    videoId,
    channelId: CHANNEL,
    channelTitle: "A channel",
    title: `Video ${videoId}`,
    published: "2026-11-01T00:00:00.000Z",
    thumbnail: "",
    description: "",
    views: 1,
    isShort: false,
    state: "new",
    seenAt: "2026-11-01T00:00:00.000Z",
    origin: "feed",
    ...over,
  };
}

// ------------------------------------------------------------------ what an age gate looks like

test("an age or content gate is recognised in every form it arrives", () => {
  assert.ok(isAgeGatePlayability("AGE_CHECK_REQUIRED", undefined));
  assert.ok(isAgeGatePlayability("CONTENT_CHECK_REQUIRED", "This video may be inappropriate"));
  assert.ok(isAgeGatePlayability("LOGIN_REQUIRED", "Sign in to confirm your age"));
  assert.ok(isAgeGatedAnswer({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "This video may be inappropriate for some users." } }));
  assert.ok(isAgeRestricted(new Error("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.")));
  assert.ok(isAgeRestricted(new AgeRestrictedError("aaaaaaaaaaa")));
  assert.ok(isAgeRestricted({ name: "MobileResolveError", kind: "age-restricted", message: "x" }));
  assert.ok(isAdultAgeLimit(18));
});

test("members-only, the bot check and a playable video are not age gates", () => {
  assert.ok(!isAgeGatePlayability("OK", "Sign in to confirm your age"));
  assert.ok(!isAgeGatePlayability("LOGIN_REQUIRED", "Join this channel to get access to members-only content like this video."));
  assert.ok(!isAgeGatePlayability("LOGIN_REQUIRED", "Sign in to confirm you’re not a bot"));
  assert.ok(!isAgeRestricted(new Error("Sign in to confirm you're not a bot")));
  assert.ok(!isAgeRestricted(null));
  assert.ok(!isAgeRestricted(new Error("HTTP 403: page restricted")));
  assert.ok(!isAgeGatedAnswer({ playabilityStatus: { status: "OK" } }));
  assert.ok(!isAdultAgeLimit(0));
  assert.ok(!isAdultAgeLimit(undefined));
});

test("the mobile resolver turns an age gate into its own failure kind", () => {
  const problem = playabilityFailure({ playabilityStatus: { status: "AGE_CHECK_REQUIRED" } });
  assert.equal(problem?.kind, "age-restricted");
  assert.equal(problem?.message, AGE_BLOCKED_MESSAGE);
});

test("an age gate ends the tier walk: no other tier, and no YouTube player", () => {
  assert.ok(endsTierWalk(new AgeRestrictedError("aaaaaaaaaaa")));
  assert.ok(!endsTierWalk(new Error("network")));
});

test("a report goes to the listener, and a throwing listener does not escape", () => {
  const seen: string[] = [];
  onAgeRestricted((id) => seen.push(id));
  reportAgeRestricted("aaaaaaaaaaa");
  reportAgeRestricted("");
  onAgeRestricted(() => {
    throw new Error("boom");
  });
  const quiet = console.error;
  console.error = () => undefined;
  try {
    assert.doesNotThrow(() => reportAgeRestricted("bbbbbbbbbbb"));
  } finally {
    console.error = quiet;
    onAgeRestricted(null);
  }
  assert.deepEqual(seen, ["aaaaaaaaaaa"]);
});

// ------------------------------------------------------------------ asking YouTube to leave them out

test("the player request never waves the content check through", () => {
  const body = playerBody("aaaaaaaaaaa");
  assert.equal(body.contentCheckOk, false);
  assert.equal(body.racyCheckOk, false);
});

test("search and channel browse send Restricted Mode; the player does not need it", () => {
  assert.deepEqual(requestContext(CLIENTS.web.ctx, true).user, { enableSafetyMode: true });
  assert.equal(requestContext(CLIENTS.web.ctx, false).user, undefined);
});

test("yt-dlp downloads refuse anything rated above 17", () => {
  const args = buildArgs({
    videoId: "aaaaaaaaaaa",
    ytDlpPath: "yt-dlp",
    ffmpegPath: null,
    destDir: "/tmp/yt",
    baseName: "x",
    onProgress: () => undefined,
  });
  const at = args.indexOf("--age-limit");
  assert.ok(at >= 0);
  assert.equal(args[at + 1], "17");
  // The rating is printed before the filter, since --print silences the skip line.
  assert.ok(args.some((a) => a.startsWith(`pre_process:${AGE_LIMIT_PREFIX}`)));
});

// ------------------------------------------------------------------ the synced list and the hub

test("the ageRestricted list survives a load and unions across devices", () => {
  const mine = emptyState();
  mine.ageRestricted = setBlocked([], { id: "aaaaaaaaaaa", title: "A" }, true, NOW, 1000);
  const theirs = emptyState();
  theirs.ageRestricted = setBlocked([], { id: "bbbbbbbbbbb", title: "B" }, true, NOW, 1000);
  const merged = mergeStates(mine, theirs);
  assert.deepEqual(merged.ageRestricted?.map((e) => e.id).sort(), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  const reloaded = normalizeState(JSON.parse(JSON.stringify(merged)));
  assert.equal(reloaded.ageRestricted?.length, 2);
  assert.deepEqual(normalizeState({}).ageRestricted, []);
});

test("a new feed video waits for its age check; a checked one stays checked after a merge", () => {
  const { added } = mergeItems([], { id: CHANNEL, title: "C", addedAt: NOW.toISOString() }, [
    { videoId: "aaaaaaaaaaa", title: "t", published: NOW.toISOString(), thumbnail: "", description: "", views: 1 },
  ], NOW);
  assert.equal(added[0].ageCheck, "pending");

  const mine = emptyState();
  mine.items = [item("aaaaaaaaaaa", { ageCheck: "pending" })];
  const theirs = emptyState();
  theirs.items = [item("aaaaaaaaaaa")];
  assert.equal(mergeStates(mine, theirs).items[0].ageCheck, undefined, "one device cleared it");
  theirs.items = [item("aaaaaaaaaaa", { ageCheck: "pending" })];
  assert.equal(mergeStates(mine, theirs).items[0].ageCheck, "pending");
});

test("lists hide age-restricted and still-unchecked videos; History keeps an unchecked one", () => {
  const items = [item("okokokokoko"), item("pendingpend", { ageCheck: "pending" }), item("blockedbloc")];
  const blocked = new Set(["blockedbloc"]);
  const shown = visibleItems(items, { filter: "all", channelId: null, includeShorts: true, blocked });
  assert.deepEqual(shown.map((i) => i.videoId), ["okokokokoko"]);
  const history = new Map(items.map((i) => [i.videoId, "2026-11-12T00:00:00.000Z"]));
  const watched = visibleItems(items, { filter: "history", channelId: null, includeShorts: true, history, blocked });
  assert.deepEqual(watched.map((i) => i.videoId).sort(), ["okokokokoko", "pendingpend"]);
});

test("notifications skip age-restricted and still-unchecked videos", () => {
  const items = [item("okokokokoko"), item("pendingpend", { ageCheck: "pending" }), item("blockedbloc")];
  const picked = pickNotifiable(items, items, [], { blocked: new Set(["blockedbloc"]) });
  assert.deepEqual(picked.map((i) => i.videoId), ["okokokokoko"]);
});

// ------------------------------------------------------------------ a download that meets one

/** A stand-in yt-dlp that prints the given stdout lines and exits 0. */
function fakeYtDlp(lines: string[]): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ytfree-age-"));
  const path = join(dir, "yt-dlp");
  writeFileSync(path, `#!/bin/sh\n${lines.map((l) => `printf '%s\\n' '${l}'`).join("\n")}\nexit 0\n`);
  chmodSync(path, 0o755);
  return { path, dir };
}

function download(ytDlpPath: string, destDir: string) {
  return downloadVideo({
    videoId: "aaaaaaaaaaa",
    ytDlpPath,
    ffmpegPath: null,
    destDir,
    baseName: "x [aaaaaaaaaaa]",
    onProgress: () => undefined,
  }).done;
}

test("a download yt-dlp skipped for its 18+ rating is refused as age-restricted", async () => {
  const fake = fakeYtDlp([`${AGE_LIMIT_PREFIX}18`]);
  try {
    await assert.rejects(download(fake.path, fake.dir), (err: unknown) => isAgeRestricted(err));
  } finally {
    rmSync(fake.dir, { recursive: true, force: true });
  }
});

test("a normal download whose title mentions an age gate still succeeds", async () => {
  const fake = fakeYtDlp([`${AGE_LIMIT_PREFIX}0`]);
  const saved = join(fake.dir, "Why my video got age-restricted [aaaaaaaaaaa].mp4");
  writeFileSync(saved, "");
  writeFileSync(fake.path, `#!/bin/sh\nprintf '%s\\n' '${AGE_LIMIT_PREFIX}0' '${saved}'\nexit 0\n`);
  try {
    assert.equal(await download(fake.path, fake.dir), saved);
  } finally {
    rmSync(fake.dir, { recursive: true, force: true });
  }
});
