import { test } from "node:test";
import assert from "node:assert/strict";
import { logLine, parsePlayerMessage, playerErrorText, playerPageUrl, qualityLabel } from "../src/youtube-player.ts";

test("playerPageUrl carries the video, a whole-second start and a non-1 speed", () => {
  assert.equal(
    playerPageUrl("aqz-KE-bpKQ", 31.9, 1.5),
    "https://barkernotbob.github.io/obsidian-ytfree/player/?v=aqz-KE-bpKQ&t=31&rate=1.5",
  );
  assert.equal(playerPageUrl("aqz-KE-bpKQ", 0, 1), "https://barkernotbob.github.io/obsidian-ytfree/player/?v=aqz-KE-bpKQ");
  assert.equal(playerPageUrl("aqz-KE-bpKQ", -4, 1), "https://barkernotbob.github.io/obsidian-ytfree/player/?v=aqz-KE-bpKQ");
});

test("parsePlayerMessage reads the page's messages and nothing else", () => {
  assert.equal(parsePlayerMessage(null), null);
  assert.equal(parsePlayerMessage("x"), null);
  assert.equal(parsePlayerMessage({ source: "other", type: "ready" }), null);
  assert.equal(parsePlayerMessage({ source: "ytfree-player", type: "nope" }), null);
  assert.deepEqual(parsePlayerMessage({ source: "ytfree-player", type: "ready" }), { type: "ready" });
  assert.deepEqual(parsePlayerMessage({ source: "ytfree-player", type: "error", code: 153 }), { type: "error", code: 153 });
  assert.deepEqual(
    parsePlayerMessage({ source: "ytfree-player", type: "status", time: 12.5, duration: "x", state: 1, quality: "hd1080" }),
    { type: "status", time: 12.5, duration: 0, state: 1, rate: 1, quality: "hd1080" },
  );
});

test("quality and error text", () => {
  assert.equal(qualityLabel("hd1080"), "1080p");
  assert.equal(qualityLabel("medium"), "360p");
  assert.equal(qualityLabel(""), "…");
  assert.equal(qualityLabel("weird"), "weird");
  assert.match(playerErrorText(150), /doesn't allow/);
  assert.match(playerErrorText(153), /153/);
  assert.match(playerErrorText("x"), /\(x\)/);
});

test("playerPageUrl asks for a cued, unstarted player only when told not to play", () => {
  assert.equal(
    playerPageUrl("aqz-KE-bpKQ", 12, 1, false),
    "https://barkernotbob.github.io/obsidian-ytfree/player/?v=aqz-KE-bpKQ&t=12&play=0",
  );
  assert.equal(playerPageUrl("aqz-KE-bpKQ", 12, 1, true), "https://barkernotbob.github.io/obsidian-ytfree/player/?v=aqz-KE-bpKQ&t=12");
});

test("log messages keep plain values only, and print as one line", () => {
  assert.deepEqual(
    parsePlayerMessage({ source: "ytfree-player", type: "log", event: "youtube state", to: 2, vis: "hidden", obj: { x: 1 } }),
    { type: "log", event: "youtube state", data: { to: 2, vis: "hidden" } },
  );
  assert.equal(parsePlayerMessage({ source: "ytfree-player", type: "log" }), null);
  const at = new Date(2026, 10, 10, 17, 4, 5, 7);
  assert.equal(logLine(at, "page", "youtube state", { to: 2, vis: "hidden" }), "17:04:05.007 page · youtube state to=2 vis=hidden");
  assert.equal(logLine(at, "plugin", "opened"), "17:04:05.007 plugin · opened");
});
