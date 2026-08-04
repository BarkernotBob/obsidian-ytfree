import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchScreenInput } from "../src/search-screen.ts";
import { searchScreen } from "../src/search-screen.ts";

/**
 * The screen's wording, pinned.
 *
 * These were six string literals split across `renderStatus` and `renderSearch`
 * in `hub.ts`, written months apart, and they disagreed: the status strip said
 * `Nothing found for “x”.` while the block behind it said `No results.` for the
 * same moment. One function now answers both, and the disagreement is the thing
 * these tests exist to stop coming back.
 */

function input(overrides: Partial<SearchScreenInput> = {}): SearchScreenInput {
  return {
    query: null,
    state: "idle",
    error: "",
    results: 0,
    skipped: 0,
    filtersSet: false,
    ...overrides,
  };
}

test("nothing searched for yet says what the screen is for", () => {
  const copy = searchScreen(input());
  assert.equal(copy.kind, "idle");
  assert.equal(copy.status, "Type a search and press Enter");
  assert.equal(copy.headline, "Search all of YouTube");
  assert.match(copy.help, /nothing here plays/i);
  assert.equal(copy.retry, false);
});

test("filters set before a query is said in the status line", () => {
  const copy = searchScreen(input({ filtersSet: true }));
  assert.equal(copy.kind, "idle");
  assert.match(copy.status, /^Filters set/);
});

test("a first page in flight is a loading state", () => {
  const copy = searchScreen(input({ query: "obsidian", state: "loading" }));
  assert.equal(copy.kind, "loading");
  assert.equal(copy.status, "Searching for “obsidian”…");
  assert.equal(copy.headline, "Searching YouTube…");
  assert.equal(copy.retry, false);
});

test("a second page in flight leaves the results on screen", () => {
  // `loadMore` sets state to "loading" with results already drawn. The screen
  // must not throw them away for a spinner.
  const copy = searchScreen(input({ query: "obsidian", state: "loading", results: 20 }));
  assert.equal(copy.kind, "results");
  assert.equal(copy.status, "20 results for “obsidian”");
});

test("a failure carries the reason and offers a retry", () => {
  const copy = searchScreen(
    input({ query: "obsidian", state: "error", error: "net::ERR_INTERNET_DISCONNECTED" }),
  );
  assert.equal(copy.kind, "error");
  assert.equal(copy.status, "Search failed — net::ERR_INTERNET_DISCONNECTED");
  assert.equal(copy.headline, "Search failed");
  assert.equal(copy.help, "net::ERR_INTERNET_DISCONNECTED");
  assert.equal(copy.retry, true);
});

test("a failure with no message still says something actionable", () => {
  const copy = searchScreen(input({ query: "obsidian", state: "error", error: "" }));
  assert.match(copy.help, /connection/i);
  assert.equal(copy.retry, true);
});

test("an error wins over an empty query", () => {
  // Clearing the box clears the query but a failed load may still be the last
  // thing that happened; the failure is the more useful of the two answers.
  const copy = searchScreen(input({ query: null, state: "error", error: "boom" }));
  assert.equal(copy.kind, "error");
});

test("nothing found suggests fewer words", () => {
  const copy = searchScreen(input({ query: "qwzxvplk 8817" }));
  assert.equal(copy.kind, "none");
  assert.equal(copy.status, "Nothing found for “qwzxvplk 8817”");
  assert.equal(copy.headline, "Nothing found for “qwzxvplk 8817”");
  assert.match(copy.help, /fewer words/);
  assert.doesNotMatch(copy.help, /filters/);
  assert.equal(copy.retry, false);
});

test("nothing found with filters on blames the filters too", () => {
  const copy = searchScreen(input({ query: "music", filtersSet: true }));
  assert.equal(copy.kind, "none");
  assert.match(copy.help, /loosen the filters/);
});

test("everything already in the hub is a different answer from nothing found", () => {
  const copy = searchScreen(input({ query: "veritasium", results: 0, skipped: 20 }));
  assert.equal(copy.kind, "allInHub");
  assert.equal(copy.status, "20 results · all already in your hub");
  assert.equal(copy.headline, "You already have all of these");
  assert.match(copy.help, /saved, kept, or hidden/);
});

test("one skipped result is singular", () => {
  const copy = searchScreen(input({ query: "x", results: 0, skipped: 1 }));
  assert.equal(copy.status, "1 result · all already in your hub");
});

test("results count, query, and what was left out", () => {
  const copy = searchScreen(input({ query: "obsidian", results: 17, skipped: 3 }));
  assert.equal(copy.kind, "results");
  assert.equal(copy.status, "17 results for “obsidian” · 3 already in your hub");
  assert.equal(copy.headline, "");
  assert.equal(copy.help, "");
  assert.equal(copy.retry, false);
});

test("one result is singular, and nothing skipped is not mentioned", () => {
  const copy = searchScreen(input({ query: "obsidian", results: 1 }));
  assert.equal(copy.status, "1 result for “obsidian”");
});

test("the status line is one short line in every state", () => {
  // It is drawn into a strip with a reserved height and `white-space: nowrap`.
  // A status that needs two lines is a status that gets an ellipsis.
  const states: SearchScreenInput[] = [
    input(),
    input({ filtersSet: true }),
    input({ query: "obsidian", state: "loading" }),
    input({ query: "obsidian", results: 20, skipped: 4 }),
    input({ query: "obsidian" }),
    input({ query: "obsidian", skipped: 20 }),
  ];
  for (const state of states) {
    const { status } = searchScreen(state);
    assert.ok(status.length > 0, "every state says something");
    assert.ok(status.length <= 60, `too long for the strip: ${status}`);
    assert.doesNotMatch(status, /\n/);
  }
});

test("only the failure offers a retry", () => {
  const kinds: SearchScreenInput[] = [
    input(),
    input({ query: "x", state: "loading" }),
    input({ query: "x" }),
    input({ query: "x", skipped: 5 }),
    input({ query: "x", results: 5 }),
  ];
  for (const state of kinds) assert.equal(searchScreen(state).retry, false);
});
