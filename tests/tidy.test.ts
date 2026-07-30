import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIDY_DAYS, hasWriting, notesToTidy, tidyable } from "../src/tidy.ts";
import type { TidyCandidate } from "../src/tidy.ts";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const ID = "dQw4w9WgXcQ";

function daysAgo(days: number): number {
  return NOW.getTime() - days * 86_400_000;
}

/** The note a hub click produces, once the transcript has landed in it. */
function noteWith(notes: string): string {
  return [
    "---",
    'title: "Some video"',
    `media_link: https://www.youtube.com/watch?v=${ID}`,
    "tags: []",
    "---",
    "# Notes",
    notes,
    "",
    "# Video Description",
    "Subscribe for more.",
    "",
    "# Video Transcript",
    "00:00 hello and welcome",
    "",
  ].join("\n");
}

function candidate(over: Partial<TidyCandidate> = {}): TidyCandidate {
  return {
    path: "Watch Later/Some video.md",
    videoId: ID,
    watchedAt: new Date(daysAgo(40)).toISOString(),
    modifiedAt: daysAgo(40),
    content: noteWith(""),
    tagged: false,
    open: false,
    ...over,
  };
}

test("an untouched note is writing-free", () => {
  assert.equal(hasWriting(noteWith("")), false);
  assert.equal(hasWriting(noteWith("\n \t")), false);
});

test("one line under Notes is writing", () => {
  assert.equal(hasWriting(noteWith("[[00:12]] the bit about the pump")), true);
});

test("a tag counts as writing", () => {
  assert.equal(hasWriting(noteWith(""), true), true);
});

test("text above the first heading counts as writing", () => {
  const content = noteWith("").replace("# Notes", "Reminder: send this to Dad\n\n# Notes");
  assert.equal(hasWriting(content), true);
});

test("a note with no Notes heading is not ours to judge", () => {
  assert.equal(hasWriting("---\ntitle: x\n---\n\nJust a note.\n"), true);
  assert.equal(hasWriting(""), true);
});

test("the description and the transcript are not writing", () => {
  // Both are written by the plugin, and a description carrying the video's own
  // chapter list must not read as notes.
  const content = noteWith("").replace("Subscribe for more.", "## Chapters\n0:00 Intro");
  assert.equal(hasWriting(content), false);
});

test("a legacy note with `## Notes` is read the same way", () => {
  const content = noteWith("").replace("# Notes", "## Notes");
  assert.equal(hasWriting(content), false);
  assert.equal(hasWriting(content.replace("## Notes", "## Notes\nsomething")), true);
});

test("the plain case: watched, untouched, empty, a month gone", () => {
  assert.equal(tidyable(candidate(), NOW, DEFAULT_TIDY_DAYS), true);
});

test("a video that was never played is left alone", () => {
  assert.equal(tidyable(candidate({ watchedAt: null }), NOW, DEFAULT_TIDY_DAYS), false);
  assert.equal(tidyable(candidate({ watchedAt: "whenever" }), NOW, DEFAULT_TIDY_DAYS), false);
});

test("a video watched this week is left alone", () => {
  const watchedAt = new Date(daysAgo(3)).toISOString();
  assert.equal(tidyable(candidate({ watchedAt }), NOW, DEFAULT_TIDY_DAYS), false);
});

test("a recently edited note is left alone, whatever the edit was", () => {
  assert.equal(tidyable(candidate({ modifiedAt: daysAgo(2) }), NOW, DEFAULT_TIDY_DAYS), false);
});

test("a note open in front of you is left alone", () => {
  assert.equal(tidyable(candidate({ open: true }), NOW, DEFAULT_TIDY_DAYS), false);
});

test("zero days switches the sweep off", () => {
  assert.equal(tidyable(candidate(), NOW, 0), false);
  assert.equal(tidyable(candidate(), NOW, -1), false);
});

test("notesToTidy picks only the ones that qualify", () => {
  const doomed = candidate({ path: "a.md" });
  const written = candidate({ path: "b.md", content: noteWith("a thought") });
  const fresh = candidate({ path: "c.md", modifiedAt: daysAgo(1) });
  const picked = notesToTidy([doomed, written, fresh], NOW, DEFAULT_TIDY_DAYS);
  assert.deepEqual(
    picked.map((note) => note.path),
    ["a.md"],
  );
});
