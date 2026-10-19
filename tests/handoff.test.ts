/** GitHub #3: which YouTube links open in Obsidian, at which second. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handoffUri,
  isYouTubeUrl,
  parseStartTime,
  parseYouTubeLink,
  youTubeLinkAt,
} from "../src/handoff.ts";

const ID = "-X4ZD3fisSs";

test("every URL shape names the video", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}\n`,
  ]) {
    assert.deepEqual(parseYouTubeLink(url), { videoId: ID, seconds: 0 }, url);
  }
});

test("start times in every form", () => {
  assert.equal(parseYouTubeLink(`https://youtu.be/${ID}?t=90`)?.seconds, 90);
  assert.equal(parseYouTubeLink(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.seconds, 90);
  assert.equal(parseYouTubeLink(`https://www.youtube.com/watch?v=${ID}&t=90s`)?.seconds, 90);
  assert.equal(parseYouTubeLink(`https://www.youtube.com/embed/${ID}?start=75`)?.seconds, 75);
  assert.equal(parseYouTubeLink(`https://www.youtube.com/watch?v=${ID}#t=1h2m3s`)?.seconds, 3723);
});

test("parseStartTime", () => {
  assert.equal(parseStartTime("90"), 90);
  assert.equal(parseStartTime("1:30"), 90);
  assert.equal(parseStartTime("1:02:03"), 3723);
  assert.equal(parseStartTime("2h"), 7200);
  assert.equal(parseStartTime(""), 0);
  assert.equal(parseStartTime(null), 0);
  assert.equal(parseStartTime("soon"), 0);
});

test("links that name no video, or are not YouTube, are null", () => {
  for (const url of [
    "https://www.youtube.com/@wardonwords",
    "https://www.youtube.com/channel/UCKRmL7BMyCeLE4KUo73RDzw",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/",
    `https://example.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    ID,
    "",
    "not a url",
  ]) {
    assert.equal(parseYouTubeLink(url), null, url);
  }
});

test("isYouTubeUrl refuses other schemes", () => {
  assert.equal(isYouTubeUrl(`ytfree:${ID}:90`), false);
  assert.equal(isYouTubeUrl(`javascript:alert(1)//youtube.com`), false);
  assert.equal(isYouTubeUrl(`http://youtu.be/${ID}`), true);
});

test("handoffUri round-trips through URL parsing", () => {
  const link = `https://youtu.be/${ID}?t=90`;
  const uri = handoffUri(link);
  assert.equal(uri, "obsidian://ytfree?url=https%3A%2F%2Fyoutu.be%2F-X4ZD3fisSs%3Ft%3D90");
  assert.equal(new URL(uri).searchParams.get("url"), link);
});

test("youTubeLinkAt finds markdown links, autolinks and bare URLs", () => {
  const md = `See [the talk](https://youtu.be/${ID}?t=90) today`;
  assert.equal(youTubeLinkAt(md, 6)?.url, `https://youtu.be/${ID}?t=90`);
  assert.equal(youTubeLinkAt(md, 0), null);
  assert.equal(youTubeLinkAt(md, md.length - 1), null);

  const auto = `x <https://www.youtube.com/watch?v=${ID}> y`;
  assert.equal(youTubeLinkAt(auto, 5)?.url, `https://www.youtube.com/watch?v=${ID}`);

  const bare = `watch https://youtu.be/${ID} later`;
  assert.equal(youTubeLinkAt(bare, 10)?.url, `https://youtu.be/${ID}`);
});

test("youTubeLinkAt ignores embeds and other sites", () => {
  assert.equal(youTubeLinkAt(`![](https://youtu.be/${ID})`, 5), null);
  assert.equal(youTubeLinkAt(`[a](https://example.com/x)`, 2), null);
  assert.equal(youTubeLinkAt(`https://example.com/x`, 3), null);
});

test("the bookmarklet points at the handler", async () => {
  const { HANDOFF_BOOKMARKLET } = await import("../src/handoff.ts");
  assert.match(HANDOFF_BOOKMARKLET, /^javascript:location\.href='obsidian:\/\/ytfree\?url='\+encodeURIComponent\(location\.href\)$/);
});
