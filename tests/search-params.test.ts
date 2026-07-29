import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchFilters } from "../src/search-params.ts";
import {
  DURATION_OPTIONS,
  FEATURE_OPTIONS,
  SORT_OPTIONS,
  UPLOAD_DATE_OPTIONS,
  defaultFilters,
  encodeSearchParams,
  isDefaultFilters,
} from "../src/search-params.ts";

/**
 * These are exact-string tests on purpose.
 *
 * A wrong `params` is not rejected by YouTube — it is ignored, and the search
 * comes back unfiltered and plausible. So there is no runtime signal to catch a
 * regression here, and the only defence is pinning the bytes. Two of the vectors
 * below (`EgQQARgC`, `CAMSBggFEAEYAg`) were sent to YouTube on 2026-07-28 and
 * the results checked against the filter they claim to be; the rest are the same
 * encoder over the field numbers recorded in `search-params.ts`.
 */

function filters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return { ...defaultFilters(), ...overrides };
}

test("no filters still pins the search to videos", () => {
  // filters { type: VIDEO } — a proto3 zero is absent from the wire, so "Any
  // time / Any length / Relevance" encodes to the type and nothing else.
  assert.equal(encodeSearchParams(defaultFilters()), "EgIQAQ");
});

test("duration uses YouTube's numbering, not size order", () => {
  // short = 1, long = 2, medium = 3. Getting these in size order would silently
  // swap "over 20 minutes" and "4–20 minutes".
  assert.equal(encodeSearchParams(filters({ duration: "short" })), "EgQQARgB");
  assert.equal(encodeSearchParams(filters({ duration: "long" })), "EgQQARgC");
  assert.equal(encodeSearchParams(filters({ duration: "medium" })), "EgQQARgD");
});

test("upload date rides in the filter message", () => {
  assert.equal(encodeSearchParams(filters({ uploadDate: "hour" })), "EgQIARAB");
  assert.equal(encodeSearchParams(filters({ uploadDate: "today" })), "EgQIAhAB");
});

test("sort is a top-level field, outside the filters", () => {
  assert.equal(encodeSearchParams(filters({ sort: "date" })), "CAISAhAB");
});

test("each feature is its own bool field", () => {
  assert.equal(encodeSearchParams(filters({ feature: "hd" })), "EgQQASAB");
  assert.equal(encodeSearchParams(filters({ feature: "subtitles" })), "EgQQASgB");
  assert.equal(encodeSearchParams(filters({ feature: "creativeCommons" })), "EgQQATAB");
  assert.equal(encodeSearchParams(filters({ feature: "live" })), "EgQQAUAB");
  assert.equal(encodeSearchParams(filters({ feature: "fourK" })), "EgQQAXAB");
});

test("filters combine, in ascending field order", () => {
  // Sent live: sort by views, this year, over 20 minutes. Ascending order is
  // what makes the string byte-identical to youtube.com's own `sp=` for the
  // same choices, which is what made it checkable in the first place.
  assert.equal(
    encodeSearchParams(filters({ sort: "views", uploadDate: "year", duration: "long" })),
    "CAMSBggFEAEYAg",
  );
  assert.equal(
    encodeSearchParams(
      filters({ sort: "rating", uploadDate: "week", duration: "medium", feature: "subtitles" }),
    ),
    "CAESCAgDEAEYAygB",
  );
});

test("the encoding is base64url, never plain base64", () => {
  // `+` and `/` in a query string are a corrupted request rather than an error.
  const every = [
    defaultFilters(),
    filters({ sort: "views", uploadDate: "year", duration: "long", feature: "fourK" }),
    ...UPLOAD_DATE_OPTIONS.map(([uploadDate]) => filters({ uploadDate })),
    ...DURATION_OPTIONS.map(([duration]) => filters({ duration })),
    ...SORT_OPTIONS.map(([sort]) => filters({ sort })),
    ...FEATURE_OPTIONS.map(([feature]) => filters({ feature })),
  ];
  for (const one of every) assert.match(encodeSearchParams(one), /^[A-Za-z0-9_-]+$/);
});

test("isDefaultFilters knows when the bar has been touched", () => {
  assert.equal(isDefaultFilters(defaultFilters()), true);
  assert.equal(isDefaultFilters(filters({ duration: "long" })), false);
  assert.equal(isDefaultFilters(filters({ sort: "date" })), false);
  assert.equal(isDefaultFilters(filters({ uploadDate: "week" })), false);
  assert.equal(isDefaultFilters(filters({ feature: "hd" })), false);
});

test("every option the control offers encodes to something", () => {
  // The dropdowns are built from these lists, so a value with no field number
  // would be a menu entry that quietly does nothing.
  for (const [uploadDate] of UPLOAD_DATE_OPTIONS) {
    assert.ok(encodeSearchParams(filters({ uploadDate })).length > 0);
  }
  for (const [duration] of DURATION_OPTIONS) {
    assert.ok(encodeSearchParams(filters({ duration })).length > 0);
  }
  for (const [sort] of SORT_OPTIONS) assert.ok(encodeSearchParams(filters({ sort })).length > 0);
  for (const [feature] of FEATURE_OPTIONS) {
    assert.ok(encodeSearchParams(filters({ feature })).length > 0);
  }
});
