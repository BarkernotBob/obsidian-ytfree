import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPlaceholder,
  maxresMidFrameUrl,
  midFrameUrl,
  sharperUrlFor,
  showThumbnail,
  thumbnailCandidates,
} from "../src/thumbnail.ts";

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

test("a large picture asks for maxres2 after hq2 loads", () => {
  const hq2 = midFrameUrl("abc123");
  // The phone's full-width Preview poster: about 390 CSS px on a 3x screen.
  assert.equal(sharperUrlFor(hq2, 390, 3), "https://i.ytimg.com/vi/abc123/maxres2.jpg");
  assert.equal(maxresMidFrameUrl("abc123"), "https://i.ytimg.com/vi/abc123/maxres2.jpg");
  // A wide desktop card at 1x.
  assert.equal(sharperUrlFor(hq2, 800, 1), maxresMidFrameUrl("abc123"));
});

test("a small card never spends a request on maxres2", () => {
  const hq2 = midFrameUrl("abc123");
  assert.equal(sharperUrlFor(hq2, 160, 2), null); // desktop hub card, retina
  assert.equal(sharperUrlFor(hq2, 175, 3), null); // phone two-up card
  assert.equal(sharperUrlFor(hq2, 480, 1), null); // hq2 at its own size
  assert.equal(sharperUrlFor(hq2, 0, 3), null); // not laid out
  assert.equal(sharperUrlFor(hq2, 185, 4), null); // phone two-up card, 4x screen
  assert.equal(sharperUrlFor(hq2, 160, 6), null); // desktop card at 300% zoom
});

test("only the hq2 halfway still is upgraded, never a Short or the stored fallback", () => {
  assert.equal(sharperUrlFor(STORED, 390, 3), null);
  assert.equal(sharperUrlFor("https://i.ytimg.com/vi/abc123/oardefault.jpg", 390, 3), null);
  assert.equal(sharperUrlFor(maxresMidFrameUrl("abc123"), 390, 3), null);
});

/**
 * A stand-in `<img>` and `Image` just big enough to drive `showThumbnail`:
 * `load(width)` / `fail()` play the browser's part for whatever `src` is now.
 */
function fakeDom(cssWidth: number, maxresWidth: number | null) {
  const probes: { src: string; naturalWidth: number; onload: (() => void) | null }[] = [];
  const g = globalThis as Record<string, unknown>;
  g.window = { devicePixelRatio: 3 };
  g.Image = class {
    src = "";
    naturalWidth = 0;
    onload: (() => void) | null = null;
    constructor() {
      probes.push(this);
    }
  };
  const img = {
    src: "",
    naturalWidth: 0,
    isConnected: true,
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    getBoundingClientRect: () => ({ width: cssWidth }),
    load(width: number) {
      this.naturalWidth = width;
      this.onload?.();
    },
  };
  const settleProbes = () => {
    for (const p of probes.splice(0)) {
      if (maxresWidth !== null) {
        p.naturalWidth = maxresWidth;
        p.onload?.();
      }
    }
  };
  return { img, probes, settleProbes };
}

test("a large HD picture swaps to maxres2; a non-HD one keeps hq2", () => {
  const hd = fakeDom(390, 1280);
  showThumbnail(hd.img as unknown as HTMLImageElement, thumbnailCandidates("abc123", STORED));
  hd.img.load(480);
  assert.equal(hd.probes[0]?.src, maxresMidFrameUrl("abc123"));
  hd.settleProbes();
  assert.equal(hd.img.src, maxresMidFrameUrl("abc123"));

  // YouTube's grey stand-in for a video with no maxres2.
  const sd = fakeDom(390, 120);
  showThumbnail(sd.img as unknown as HTMLImageElement, thumbnailCandidates("abc123", STORED));
  sd.img.load(480);
  sd.settleProbes();
  assert.equal(sd.img.src, midFrameUrl("abc123"));
});

test("a small card loads hq2 and asks for nothing else", () => {
  const small = fakeDom(160, 1280);
  showThumbnail(small.img as unknown as HTMLImageElement, thumbnailCandidates("abc123", STORED));
  small.img.load(480);
  assert.equal(small.probes.length, 0);
  assert.equal(small.img.src, midFrameUrl("abc123"));
});
