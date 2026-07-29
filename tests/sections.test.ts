import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_HEADINGS,
  foldableRanges,
  headingLine,
  normaliseHeadings,
  sectionEnd,
} from "../src/sections.ts";

/** A current note, with line numbers that the assertions below count on. */
const NOTE = [
  "---", //                0
  'title: "A video"', //   1
  "---", //                2
  "", //                   3
  "# Notes", //            4
  "", //                   5
  "", //                   6
  "# Video Description", //7
  "0:00 Intro", //         8
  "", //                   9
  "# Most replayed", //   10
  "- **[1:00](x)**", //   11
  "", //                  12
  "# Video Transcript", //13
  "words", //             14
].join("\n");

test("headingLine finds a section by any spelling it has ever had", () => {
  assert.equal(headingLine(NOTE, SECTION_HEADINGS.description), 7);
  assert.equal(headingLine("## Description\nx", SECTION_HEADINGS.description), 0);
  assert.equal(headingLine("## Transcript\nx", SECTION_HEADINGS.transcript), 0);
});

test("headingLine will not match a heading that merely starts the same way", () => {
  assert.equal(headingLine("# Notes on the paper\n", SECTION_HEADINGS.notes), -1);
});

test("headingLine answers -1 for a section the note does not have", () => {
  assert.equal(headingLine(NOTE, ["# Chapters"]), -1);
});

test("sectionEnd stops on the line above the next heading, of either level", () => {
  assert.equal(sectionEnd(NOTE, 7), 9);
  assert.equal(sectionEnd(NOTE, 13), 14); // the last section runs to the end
  assert.equal(sectionEnd("# A\nbody\n## B\nmore", 0), 1);
});

test("foldableRanges covers the sections asked for, in document order", () => {
  const ranges = foldableRanges(NOTE, [
    SECTION_HEADINGS.transcript,
    SECTION_HEADINGS.description,
    ["# Most replayed"],
  ]);
  assert.deepEqual(ranges, [
    { from: 7, to: 9 },
    { from: 10, to: 12 },
    { from: 13, to: 14 },
  ]);
});

test("foldableRanges leaves out a section with nothing under it", () => {
  const bare = "# Video Description\n# Video Transcript\nwords";
  assert.deepEqual(foldableRanges(bare, [SECTION_HEADINGS.description]), []);
});

test("foldableRanges folds a note that still has the old headings", () => {
  const old = "## Description\ntext\n\n## Transcript\nwords";
  assert.deepEqual(
    foldableRanges(old, [SECTION_HEADINGS.description, SECTION_HEADINGS.transcript]),
    [
      { from: 0, to: 2 },
      { from: 3, to: 4 },
    ],
  );
});

test("normaliseHeadings promotes the old headings and renames the two that moved", () => {
  const old = "## Notes\n\nmine\n\n## Description\ntext\n\n## Transcript\nwords\n\n## Most replayed\n- x";
  assert.equal(
    normaliseHeadings(old),
    "# Notes\n\nmine\n\n# Video Description\ntext\n\n# Video Transcript\nwords\n\n# Most replayed\n- x",
  );
});

test("normaliseHeadings is idempotent and leaves other headings alone", () => {
  assert.equal(normaliseHeadings(NOTE), NOTE);
  assert.equal(normaliseHeadings("## My own heading\nx"), "## My own heading\nx");
});
