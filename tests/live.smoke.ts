/**
 * Live smoke test — hits YouTube for real.
 *
 * This is the canary for the project's biggest risk: YouTube changing
 * extraction so yt-dlp stops resolving streams. Unit tests cannot catch that.
 * Run before shipping any change, and whenever playback starts failing.
 *
 *   npm run smoke
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findYtDlp, resolveStream } from "../src/desktop/resolver.ts";
import { parseExpiry } from "../src/stream.ts";

// Stable, long-lived, non-age-restricted video.
const VIDEO_ID = "dQw4w9WgXcQ";
/** A second one, deliberately not from the same decade or the same uploader. */
const OTHER_VIDEO_ID = "jNQXAC9IVRw";

test("yt-dlp is installed and findable without a shell PATH", async () => {
  const path = await findYtDlp("");
  assert.ok(path.endsWith("yt-dlp"), `unexpected path: ${path}`);
});

test("HLS resolution returns a manifest with a real expiry", async () => {
  const ytDlp = await findYtDlp("");
  const stream = await resolveStream(VIDEO_ID, ytDlp, "quality");

  assert.ok(stream.url.startsWith("https://"), "must be an https URL");
  assert.equal(stream.isHls, true, "preferHls should yield an HLS manifest");
  assert.ok(
    parseExpiry(stream.url) > Date.now(),
    "expiry must parse to a future time — if this fails, googlevideo changed its URL shape",
  );
});

test("progressive MP4 resolution works as the fallback path", async () => {
  const ytDlp = await findYtDlp("");
  const stream = await resolveStream(VIDEO_ID, ytDlp, "fast");
  assert.ok(stream.url.includes("videoplayback"), "expected a direct videoplayback URL");
  assert.equal(stream.isHls, false);
});

test("the resolved stream actually serves video bytes", async () => {
  // The end-to-end proof, and the one that earns the whole file: on 2026-08-17
  // every other test here passed while nothing played, because `android_vr`
  // resolved happily and then answered 403 to the first byte.
  const ytDlp = await findYtDlp("");
  const stream = await resolveStream(VIDEO_ID, ytDlp, "fast");

  const res = await fetch(stream.url, { headers: { Range: "bytes=0-65535" } });
  assert.equal(res.status, 206, "expected HTTP 206 Partial Content");
  assert.match(res.headers.get("content-type") ?? "", /^video\//);

  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.length > 1000, `got only ${bytes.length} bytes`);
});

test("a second, older video serves bytes too", async () => {
  // One video can be an exception — a client that has been cut off is not. This
  // is also the case that exercises the fallback down `FAST_CLIENTS`: the
  // client this one answers on is not the one the test above uses.
  const ytDlp = await findYtDlp("");
  const stream = await resolveStream(OTHER_VIDEO_ID, ytDlp, "fast");
  const res = await fetch(stream.url, { headers: { Range: "bytes=0-4095" } });
  assert.equal(res.status, 206, "expected HTTP 206 Partial Content");
});

test("an invalid video id fails loudly rather than silently", async () => {
  const ytDlp = await findYtDlp("");
  await assert.rejects(
    () => resolveStream("aaaaaaaaaaa", ytDlp, "fast"),
    /./,
    "a bad id must throw so the UI can show an actionable error",
  );
});

// --------------------------------------------------------- subscriptions hub

/**
 * The hub's other live dependency: the channel feed, and the Shorts probe.
 *
 * Neither goes through yt-dlp, so neither is covered by the tests above. Both
 * are undocumented endpoints that YouTube can change at any time — this is what
 * would notice.
 */
test("a channel feed still carries IDs, descriptions and 15 entries", async () => {
  const { parseChannelFeed, feedUrl } = await import("../src/subscriptions.ts");
  const response = await fetch(feedUrl("UC6107grRI4m0o2-emgoDnAA"));
  assert.equal(response.status, 200);

  const feed = parseChannelFeed(await response.text());
  assert.equal(feed.channelId, "UC6107grRI4m0o2-emgoDnAA");
  assert.ok(feed.channelTitle, "the feed should name the channel");
  // The rolling window is the constraint the whole hub is designed around.
  assert.equal(feed.entries.length, 15, "the feed window is no longer 15 entries");

  const first = feed.entries[0];
  assert.match(first.videoId, /^[A-Za-z0-9_-]{11}$/);
  assert.ok(first.published && Number.isFinite(Date.parse(first.published)));
  assert.ok(first.thumbnail.startsWith("https://"));
  assert.ok(
    feed.entries.some((entry) => entry.description.length > 100),
    "no entry carried a full description — the hub's whole reason for caching at poll time",
  );
});

test("the Shorts probe still answers 303 for a long-form video", async () => {
  const { probeIsShort } = await import("../src/desktop/shorts-probe.ts");
  assert.equal(await probeIsShort("vS6HEes8daw"), false);
});

/**
 * Browse, live.
 *
 * `searchYouTube` itself needs Obsidian's `requestUrl`, so what is exercised
 * here is everything else: the request shape, and the parser against today's
 * renderer tree rather than the one recorded in the fixtures. If YouTube
 * reshapes search, this is what notices — the unit tests will happily keep
 * passing against a captured yesterday.
 */
test("InnerTube search still answers unauthenticated, with parseable results", async () => {
  const { parseSearchResponse } = await import("../src/search.ts");
  const { CLIENTS, SEARCH_URL } = await import("../src/innertube-context.ts");

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": CLIENTS.android.ua },
    body: JSON.stringify({
      query: "smarter every day",
      context: { client: { ...CLIENTS.android.ctx, hl: "en", gl: "US" } },
    }),
  });
  assert.equal(response.status, 200, "search must work with no auth and no API key");

  const page = parseSearchResponse(await response.json());
  assert.ok(page.results.length >= 10, `only ${page.results.length} results parsed`);
  assert.ok(page.continuation, "no continuation token — paging is gone");

  const first = page.results[0];
  assert.match(first.videoId, /^[A-Za-z0-9_-]{11}$/);
  assert.ok(first.title && first.channelTitle, "a result lost its title or channel");
  assert.ok(
    page.results.filter((result) => result.duration).length > page.results.length / 2,
    "durations have stopped arriving — the one thing search has that the feed does not",
  );
});

test("the player still carries a description for a search-added item", async () => {
  const { CLIENTS, PLAYER_URL, playerBody } = await import("../src/innertube-context.ts");
  const response = await fetch(PLAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": CLIENTS.android.ua },
    body: JSON.stringify({
      ...playerBody("vS6HEes8daw"),
      context: { client: { ...CLIENTS.android.ctx, hl: "en", gl: "US" } },
    }),
  });
  const body = (await response.json()) as { videoDetails?: { shortDescription?: string } };
  assert.ok(
    (body.videoDetails?.shortDescription ?? "").length > 100,
    "no description on the player response — browse would add items with empty descriptions",
  );
});

/**
 * The phone's transcript, live.
 *
 * There is no yt-dlp on iOS, so the captions have to come off the player
 * response — and the two facts that makes possible are both YouTube's to
 * withdraw: that the ANDROID client states the caption tracklist at all, and
 * that its signed `baseUrl` still serves when `fmt` is overwritten. If either
 * goes, phone notes go back to arriving without a transcript, and this is what
 * notices.
 */
test("InnerTube still carries caption tracks that serve json3", async () => {
  const { CLIENTS, PLAYER_URL, playerBody } = await import("../src/innertube-context.ts");
  const { parseJson3, pickPlayerCaptionTrack } = await import("../src/transcript.ts");

  const response = await fetch(PLAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": CLIENTS.android.ua },
    body: JSON.stringify({
      ...playerBody(VIDEO_ID),
      context: { client: { ...CLIENTS.android.ctx, hl: "en", gl: "US" } },
    }),
  });
  assert.equal(response.status, 200);

  const track = pickPlayerCaptionTrack(await response.json(), "en");
  assert.ok(track, "no English caption track on the player response");
  assert.match(track.url, /[?&]fmt=json3(&|$)/);

  // The signature covers `sparams`, and `fmt` is not in it — so overwriting the
  // format must not invalidate the URL. That is the assumption being tested.
  const captions = await fetch(track.url, { headers: { "User-Agent": CLIENTS.android.ua } });
  assert.equal(captions.status, 200, "the timedtext URL was refused");

  const cues = parseJson3(await captions.text());
  assert.ok(cues.length > 10, `only ${cues.length} cues parsed — json3 was not served`);
  assert.ok(cues.every((cue) => Number.isFinite(cue.seconds) && cue.text.length > 0));
});

/**
 * The phone's other half of a transcript fetch, and the more fragile one: the
 * heatmap exists on exactly one client at one endpoint, buried in a
 * `frameworkUpdates` mutation. Both the client identity and the burial place
 * are undocumented, so this is the test that notices when either moves.
 */
test("the WEB next endpoint still carries a replay heatmap", async () => {
  const { CLIENTS, NEXT_URL } = await import("../src/innertube-context.ts");
  const { parseHeatmapMarkers } = await import("../src/transcript.ts");

  const response = await fetch(NEXT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": CLIENTS.web.ua },
    body: JSON.stringify({
      videoId: VIDEO_ID,
      context: { client: { ...CLIENTS.web.ctx, hl: "en", gl: "US" } },
    }),
  });
  assert.equal(response.status, 200);

  const buckets = parseHeatmapMarkers(await response.json());
  assert.ok(buckets.length > 50, `only ${buckets.length} heatmap buckets — expected ~100`);
  assert.ok(
    buckets.every((b) => b.start_time! >= 0 && b.value! >= 0 && b.end_time! > b.start_time!),
    "a bucket had a nonsense time or value",
  );
  // The peaks are the point: an all-equal heatmap would parse and mean nothing.
  const values = buckets.map((b) => b.value!);
  assert.ok(Math.max(...values) > Math.min(...values), "heatmap is flat");
});
