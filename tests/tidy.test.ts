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
    content: noteWith(""),
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

test("everything the plugin writes is not writing", () => {
  // The case BarkernotBob asked for: frontmatter filled in, a heatmap above the fold,
  // a description with the video's own chapter list, a full transcript — and an
  // empty Notes section, which is the only thing that decides.
  const furnished = [
    "---",
    'title: "Some video"',
    `media_link: https://www.youtube.com/watch?v=${ID}`,
    "author: Some Channel",
    "length: 18:42",
    "tags: [video, youtube]",
    "description: A long line the fetch wrote.",
    "---",
    "# Most replayed",
    "- [[03:12]] the loudest moment",
    "- [[07:44]] and the next one",
    "",
    "# Notes",
    "",
    "# Video Description",
    "## Chapters",
    "0:00 Intro",
    "",
    "# Video Transcript",
    "00:00 hello and welcome",
    "00:04 today we are going to",
    "",
  ].join("\n");
  assert.equal(hasWriting(furnished), false);
  assert.equal(tidyable(candidate({ content: furnished }), NOW, DEFAULT_TIDY_DAYS), true);
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

test("an edit that left no notes behind does not save the note", () => {
  // The file's mtime is not read at all. A transcript fetched or a heatmap
  // backfilled last night is the plugin writing, not the reader, and it must
  // not reset the month.
  assert.equal(tidyable(candidate(), NOW, DEFAULT_TIDY_DAYS), true);
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
  const fresh = candidate({ path: "c.md", watchedAt: new Date(daysAgo(1)).toISOString() });
  const picked = notesToTidy([doomed, written, fresh], NOW, DEFAULT_TIDY_DAYS);
  assert.deepEqual(
    picked.map((note) => note.path),
    ["a.md"],
  );
});
