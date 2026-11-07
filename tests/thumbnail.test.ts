import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlaceholder, midFrameUrl, thumbnailCandidates } from "../src/thumbnail.ts";

const STORED = "https://i.ytimg.com/vi/abc123/mqdefault.jpg";

test("the halfway still comes first, the stored thumbnail second", () => {
  assert.deepEqual(thumbnailCandidates("abc123", STORED), [
    "https://i.ytimg.com/vi/abc123/hq2.jpg",
    STORED,
  ]);
  assert.equal(midFrameUrl("abc123"), "https://i.ytimg.com/vi/abc123/hq2.jpg");
});

test("a Short keeps its stored thumbnail", () => {
  assert.deepEqual(thumbnailCandidates("abc123", STORED, true), [STORED]);
});

test("a portrait (oar) thumbnail is treated as a Short", () => {
  const oar = "https://i.ytimg.com/vi/abc123/oardefault.jpg?sqp=x";
  assert.deepEqual(thumbnailCandidates("abc123", oar), [oar]);
});

test("no stored thumbnail still gets the halfway still", () => {
  assert.deepEqual(thumbnailCandidates("abc123", ""), ["https://i.ytimg.com/vi/abc123/hq2.jpg"]);
});

test("nothing at all is nothing to show", () => {
  assert.deepEqual(thumbnailCandidates("", ""), []);
});

test("YouTube's 120x90 grey stand-in counts as missing; a real still does not", () => {
  assert.equal(isPlaceholder(120), true);
  assert.equal(isPlaceholder(480), false);
  assert.equal(isPlaceholder(0), false);
});
