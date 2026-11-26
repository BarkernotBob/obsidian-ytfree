/**
 * The search parser, against recorded responses.
 *
 * Same reasoning as `innertube.test.ts`: the fixtures are real captures (see
 * `docs/spikes/search/record.mjs`), because the only thing that can really break
 * this parser is YouTube changing the shape of the renderer tree, and a fixture
 * I wrote myself can only ever confirm my own idea of the shape.
 *
 * The refusals are the point of most of these. A search response contains ads
 * and recommendation shelves — measured, in the fixture — and the whole claim
 * of `docs/V1-SCOPE-BROWSE.md` is that neither can reach the hub.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  collectPages,
  parseSearchResponse,
  parseViewCount,
  pickThumbnail,
} from "../src/search.ts";
import type { SearchPage } from "../src/search.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;
}

const firstPage = fixture("search-android.json");
const secondPage = fixture("search-android-continuation.json");

// ------------------------------------------------------------------ results

test("parses every video in the answer section", () => {
  const page = parseSearchResponse(firstPage);
  assert.equal(page.results.length, 7);
  for (const result of page.results) {
    assert.match(result.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.ok(result.title.length > 0);
  }
});

test("a result carries what a card has to draw", () => {
  const page = parseSearchResponse(firstPage);
  const result = page.results[0];
  assert.match(result.channelId, /^UC[A-Za-z0-9_-]{22}$/);
  assert.ok(result.channelTitle.length > 0);
  assert.match(result.publishedText, /ago$/);
  assert.ok(result.views !== null && result.views > 0);
  // Duration is the field the channel feed does not have, and the reason
  // search results can state one at all.
  assert.match(result.duration, /^\d+(:\d\d)+$/);
  assert.match(result.thumbnail, /^https:\/\//);
});

test("every result states a duration", () => {
  const page = parseSearchResponse(firstPage);
  const undated = page.results.filter((result) => !result.duration);
  assert.equal(undated.length, 0, `${undated.length} results with no duration`);
});

// ------------------------------------------------------------------ sections

test("only the first video-bearing section is kept (#46)", () => {
  // The fixture's page one has videos in three sections: 7, then 2 and 10
  // between the shelves. Only the first is sorted and filtered by YouTube, so
  // the other two are dropped rather than drawn under a "related" heading.
  const page = parseSearchResponse(firstPage);
  assert.equal(page.results.length, 7);
  assert.equal(page.results[0].title.startsWith("The PROBLEM with Capitalism"), true);
  const titles = page.results.map((result) => result.title);
  assert.ok(!titles.some((title) => title.startsWith("The Backwards Brain Bicycle")));
  assert.ok(!titles.some((title) => title.startsWith("TRACTOR PULLS")));
  assert.ok(page.continuation, "page one still offers the next page");
});

test("a continuation's answer section is kept whole", () => {
  assert.equal(parseSearchResponse(fixture("search-android-continuation.json")).results.length, 20);
});

test("a section with no videos in it is not the first section", () => {
  const page = parseSearchResponse({
    contents: {
      sectionListRenderer: {
        contents: [
          { itemSectionRenderer: { contents: [{ someHeaderRenderer: {} }] } },
          {
            itemSectionRenderer: {
              contents: [{ compactVideoRenderer: { videoId: "vS6HEes8daw" } }],
            },
          },
          {
            itemSectionRenderer: {
              contents: [{ compactVideoRenderer: { videoId: "aqz-KE-bpKQ" } }],
            },
          },
        ],
      },
    },
  });
  // Furniture first, then the answer; the section after the answer is dropped.
  assert.deepEqual(page.results.map((r) => r.videoId), ["vS6HEes8daw"]);
});

// ------------------------------------------------------------------ collecting pages

function fakePage(ids: string[], continuation: string | null): SearchPage {
  return {
    results: ids.map((videoId) => ({
      videoId,
      title: videoId,
      channelId: "",
      channelTitle: "",
      publishedText: "",
      views: null,
      duration: "",
      thumbnail: "",
    })),
    continuation,
  };
}

/** Pages keyed by the token that fetches them; null is page one. */
function fakeYouTube(pages: Record<string, SearchPage>): {
  fetch: (token: string | null) => Promise<SearchPage>;
  sent: Array<string | null>;
} {
  const sent: Array<string | null> = [];
  return {
    sent,
    fetch: (token) => {
      sent.push(token);
      return Promise.resolve(pages[token ?? "first"] ?? fakePage([], null));
    },
  };
}

const id = (n: number): string => `vid${String(n).padStart(8, "0")}`;

test("a new search reads page one and page two in one action", async () => {
  const yt = fakeYouTube({
    first: fakePage([id(1), id(2)], "t2"),
    t2: fakePage([id(3), id(4)], "t3"),
    t3: fakePage([id(5)], null),
  });
  const got = await collectPages(yt.fetch, () => true, null, 2);
  assert.deepEqual(yt.sent, [null, "t2"]);
  assert.deepEqual(got.results.map((r) => r.videoId), [id(1), id(2), id(3), id(4)]);
  assert.equal(got.continuation, "t3");
  assert.equal(got.pages, 2);
});

test("More results reads one page", async () => {
  const yt = fakeYouTube({ t3: fakePage([id(5)], "t4") });
  const got = await collectPages(yt.fetch, () => true, "t3", 1);
  assert.deepEqual(yt.sent, ["t3"]);
  assert.equal(got.results.length, 1);
});

test("a one-page answer stops when YouTube offers no token", async () => {
  const yt = fakeYouTube({ first: fakePage([id(1)], null) });
  const got = await collectPages(yt.fetch, () => true, null, 2);
  assert.equal(got.pages, 1);
  assert.equal(got.continuation, null);
});

test("pages whose results are all in the hub are skipped, at most four requests", async () => {
  const yt = fakeYouTube({
    first: fakePage([id(1)], "t2"),
    t2: fakePage([id(2)], "t3"),
    t3: fakePage([id(3)], "t4"),
    t4: fakePage([id(4)], "t5"),
    t5: fakePage([id(5)], null),
  });
  const got = await collectPages(yt.fetch, () => false, null, 2);
  assert.equal(got.pages, 4);
  assert.equal(got.results.length, 0);
  assert.equal(got.skipped, 4);
  assert.equal(got.continuation, "t5");
});

test("a video repeated on page two is shown once", async () => {
  const yt = fakeYouTube({
    first: fakePage([id(1), id(2)], "t2"),
    t2: fakePage([id(2), id(3)], null),
  });
  const got = await collectPages(yt.fetch, () => true, null, 2);
  assert.deepEqual(got.results.map((r) => r.videoId), [id(1), id(2), id(3)]);
  assert.equal(got.skipped, 0);
});

// ------------------------------------------------------------------ refusals

test("nothing from a recommendation shelf reaches the results", () => {
  const page = parseSearchResponse(firstPage);
  const ids = new Set(page.results.map((result) => result.videoId));

  // The shelves are `horizontalCardListRenderer` full of `videoCardRenderer`.
  // Pull their IDs straight out of the raw fixture: if any of them shows up in
  // the results, the parser has started scanning the tree instead of reading
  // one renderer, and the rabbit hole is back.
  const shelfIds: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "videoCardRenderer") {
        const id = (value as { videoId?: unknown }).videoId;
        if (typeof id === "string") shelfIds.push(id);
      }
      walk(value);
    }
  };
  walk(firstPage);

  assert.ok(shelfIds.length > 0, "fixture has no shelf to refuse");
  for (const id of shelfIds) assert.equal(ids.has(id), false, `shelf video ${id} leaked`);
});

test("ad and channel elements are not results", () => {
  // They arrive as `elementRenderer`, which the parser never looks at. The
  // assertion that matters is that they are in the fixture at all.
  const raw = JSON.stringify(firstPage);
  assert.ok(raw.includes("elementRenderer"), "fixture has no element to refuse");
  const page = parseSearchResponse(firstPage);
  // An element carries no `videoId`, so leaking one would show up as a result
  // with an empty channel and no duration.
  const hollow = page.results.filter((result) => !result.duration && !result.channelTitle);
  assert.equal(hollow.length, 0);
});

// --------------------------------------------------------------- continuation

test("page one offers a continuation token", () => {
  const page = parseSearchResponse(firstPage);
  assert.equal(typeof page.continuation, "string");
  assert.ok((page.continuation ?? "").length > 10);
});

test("a continuation answers in its own envelope and is parsed the same", () => {
  const page = parseSearchResponse(secondPage);
  assert.ok(page.results.length >= 10);
  assert.equal(typeof page.continuation, "string");
});

test("the two pages are different videos", () => {
  const first = new Set(parseSearchResponse(firstPage).results.map((r) => r.videoId));
  const second = parseSearchResponse(secondPage).results.map((r) => r.videoId);
  const overlap = second.filter((id) => first.has(id));
  assert.ok(overlap.length < second.length, "page two repeated page one entirely");
});

test("a repeated video inside one response appears once", () => {
  const video = {
    compactVideoRenderer: {
      videoId: "vS6HEes8daw",
      title: { runs: [{ text: "Twice" }] },
    },
  };
  const page = parseSearchResponse({
    contents: {
      sectionListRenderer: {
        contents: [{ itemSectionRenderer: { contents: [video, video] } }],
      },
    },
  });
  assert.equal(page.results.length, 1);
});

// ------------------------------------------------------------------ degrading

test("garbage degrades to no results rather than throwing", () => {
  for (const raw of [null, undefined, 0, "", "not json", [], {}, { contents: 3 }]) {
    const page = parseSearchResponse(raw);
    assert.deepEqual(page, { results: [], continuation: null });
  }
});

test("a section of unknown renderers yields nothing and still reads the token", () => {
  const page = parseSearchResponse({
    contents: {
      sectionListRenderer: {
        contents: [{ itemSectionRenderer: { contents: [{ somethingNewRenderer: {} }] } }],
        continuations: [{ nextContinuationData: { continuation: "TOKEN" } }],
      },
    },
  });
  assert.deepEqual(page, { results: [], continuation: "TOKEN" });
});

test("a video with a broken id is skipped, its neighbours are not", () => {
  const page = parseSearchResponse({
    contents: {
      sectionListRenderer: {
        contents: [
          {
            itemSectionRenderer: {
              contents: [
                { compactVideoRenderer: { videoId: "too-short" } },
                { compactVideoRenderer: { videoId: 42 } },
                { compactVideoRenderer: { videoId: "vS6HEes8daw" } },
              ],
            },
          },
        ],
      },
    },
  });
  assert.deepEqual(
    page.results.map((r) => r.videoId),
    ["vS6HEes8daw"],
  );
  // No title, no byline: the id stands in for the title and nothing throws.
  assert.equal(page.results[0].title, "vS6HEes8daw");
  assert.equal(page.results[0].channelId, "");
  assert.equal(page.results[0].views, null);
});

test("a channel id that is not one is dropped rather than stored", () => {
  const page = parseSearchResponse({
    contents: {
      sectionListRenderer: {
        contents: [
          {
            itemSectionRenderer: {
              contents: [
                {
                  compactVideoRenderer: {
                    videoId: "vS6HEes8daw",
                    longBylineText: {
                      runs: [
                        {
                          text: "A playlist, not a channel",
                          navigationEndpoint: { browseEndpoint: { browseId: "VLPLxyz" } },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });
  assert.equal(page.results[0].channelId, "");
  assert.equal(page.results[0].channelTitle, "A playlist, not a channel");
});

// --------------------------------------------------------------------- bits

test("view counts come back as numbers the hub can format", () => {
  assert.equal(parseViewCount("1,353,645 views"), 1353645);
  assert.equal(parseViewCount("1 view"), 1);
  assert.equal(parseViewCount("No views"), null);
  assert.equal(parseViewCount(""), null);
});

test("the thumbnail picked is the smallest one a card can fill", () => {
  const thumbs = [
    { url: "https://i.ytimg.com/a/default.webp", width: 120, height: 90 },
    { url: "https://i.ytimg.com/a/mqdefault.webp", width: 320, height: 180 },
    { url: "https://i.ytimg.com/a/hqdefault.webp", width: 480, height: 360 },
  ];
  assert.equal(pickThumbnail(thumbs), "https://i.ytimg.com/a/mqdefault.webp");
  // Nothing wide enough: take the widest there is rather than the first.
  assert.equal(pickThumbnail(thumbs.slice(0, 1)), "https://i.ytimg.com/a/default.webp");
  assert.equal(pickThumbnail([]), "");
  assert.equal(pickThumbnail(undefined), "");
  // Protocol-relative: on iOS this would resolve against capacitor://localhost.
  assert.equal(pickThumbnail([{ url: "//host/x.jpg", width: 320 }]), "https://host/x.jpg");
});
