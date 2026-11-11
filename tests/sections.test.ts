import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_HEADINGS,
  enclosingHeading,
  foldableRanges,
  foldsRevealing,
  headingLine,
  normaliseHeadings,
  notesWriteTarget,
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

// ----------------------------------------------------- unfolding a jump (035)

test("foldsRevealing drops the fold hiding the target line and keeps the rest", () => {
  const folds = [
    { from: 7, to: 9 },
    { from: 13, to: 40 },
  ];
  assert.deepEqual(foldsRevealing(folds, 20), [{ from: 7, to: 9 }]);
});

test("foldsRevealing leaves the fold on the heading the jump lands on", () => {
  // A fold hides what is under a heading, not the heading itself, so a jump to
  // the heading line has nothing to unfold.
  assert.deepEqual(foldsRevealing([{ from: 13, to: 40 }], 13), [{ from: 13, to: 40 }]);
});

test("foldsRevealing leaves an unrelated note alone", () => {
  const folds = [{ from: 13, to: 40 }];
  assert.deepEqual(foldsRevealing(folds, 100), folds);
  assert.deepEqual(foldsRevealing([], 5), []);
});

// ------------------------------------------- the Notes cursor comes back (035)

/** A `lineAt` reader over a whole note, which is what the editor gives us. */
const reader = (content: string) => (line: number) => content.split("\n")[line];

test("enclosingHeading names the section a line sits in", () => {
  assert.equal(enclosingHeading(reader(NOTE), 6), "# Notes");
  assert.equal(enclosingHeading(reader(NOTE), 8), "# Video Description");
  assert.equal(enclosingHeading(reader(NOTE), 14), "# Video Transcript");
});

test("enclosingHeading counts the heading line itself as inside its section", () => {
  assert.equal(enclosingHeading(reader(NOTE), 4), "# Notes");
});

test("enclosingHeading answers null above the first heading", () => {
  assert.equal(enclosingHeading(reader(NOTE), 1), null);
});

test("enclosingHeading gives up rather than reading a whole transcript backwards", () => {
  const long = ["# Video Transcript", ...Array(600).fill("words")].join("\n");
  assert.equal(enclosingHeading(reader(long), 500, 400), null);
  assert.equal(enclosingHeading(reader(long), 300, 400), "# Video Transcript");
});

test("notesWriteTarget goes to the first empty line after the last text", () => {
  // NOTE: heading at 4, blank 5 and 6, Description at 7. Never written in.
  assert.deepEqual(notesWriteTarget(NOTE, 4), { cursor: { line: 5, ch: 0 }, insertAt: null });
  const note = "# Notes\nfirst\n\nsecond\n\n\n# Video Description\nx";
  // The gap at line 2 has text beneath it, so it is skipped.
  assert.deepEqual(notesWriteTarget(note, 0), { cursor: { line: 4, ch: 0 }, insertAt: null });
});

test("notesWriteTarget adds a line when every line under Notes has text", () => {
  const note = "# Notes\nfirst\nsecond\n# Video Description\nx";
  assert.deepEqual(notesWriteTarget(note, 0), {
    cursor: { line: 3, ch: 0 },
    insertAt: { line: 2, ch: 6 },
  });
  // A note that ends inside Notes, and a note that is only the heading.
  assert.deepEqual(notesWriteTarget("# Notes\nlast", 0), {
    cursor: { line: 2, ch: 0 },
    insertAt: { line: 1, ch: 4 },
  });
  assert.deepEqual(notesWriteTarget("# Notes", 0), {
    cursor: { line: 1, ch: 0 },
    insertAt: { line: 0, ch: 7 },
  });
});

test("notesWriteTarget treats the reader's own headings as part of Notes", () => {
  const note = "# Notes\nintro\n## Key points\n- one\n\n# Video Transcript\nwords";
  assert.deepEqual(notesWriteTarget(note, 0), { cursor: { line: 4, ch: 0 }, insertAt: null });
});
