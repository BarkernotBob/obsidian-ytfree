/**
 * The headings a video note is made of, and everything that has to find them.
 *
 * Four things need to agree about this: the note builder, the transcript fetch
 * that rewrites two of these sections, the player's section buttons, and the
 * fold state a note opens with. They used to agree by each writing `## Notes`
 * in its own file, which is how the transcript heading and the template drifted
 * apart in the first place. One list, here.
 *
 * Platform-neutral and pure — no `obsidian` import — so the whole of it is
 * testable under plain `node --test`.
 */

// Level one, all four of them: a video note is a document whose top level is
// its sections, and Obsidian's outline and fold arrows both read better for it.
export const NOTES_HEADING = "# Notes";
export const DESCRIPTION_HEADING = "# Video Description";
export const TRANSCRIPT_HEADING = "# Video Transcript";
export const HEATMAP_HEADING = "# Most replayed";

/** The three the player offers a button for, in the order it draws them. */
export type SectionName = "notes" | "description" | "transcript";

/**
 * Every spelling of a section that has ever been written into a note.
 *
 * Notes made before this change carry `## Notes`, `## Description` and
 * `## Transcript`, and there are a lot of them. Nothing rewrites a file behind
 * the reader's back, so instead everything that *looks* for a section looks for
 * all of its spellings — the buttons work, the folds apply, and a transcript
 * re-fetch replaces the old section rather than appending a second one beside
 * it. `normaliseHeadings` is the deliberate, opt-in half of the same story.
 */
export const SECTION_HEADINGS: Record<SectionName, string[]> = {
  notes: [NOTES_HEADING, "## Notes"],
  description: [DESCRIPTION_HEADING, "## Video Description", "# Description", "## Description"],
  transcript: [TRANSCRIPT_HEADING, "## Video Transcript", "# Transcript", "## Transcript"],
};

/** The same, for the two headings the transcript fetch owns. */
export const TRANSCRIPT_ALIASES = SECTION_HEADINGS.transcript;
export const HEATMAP_ALIASES = [HEATMAP_HEADING, "## Most replayed"];

/** Level one or level two — what counts as the end of a section. */
const HEADING_RE = /^#{1,2}\s/;

/**
 * The line a heading is on, or -1.
 *
 * Matched against the whole trimmed line rather than a prefix, so `# Notes`
 * cannot be found by a line reading `# Notes on the paper`.
 */
export function headingLine(content: string, headings: string[]): number {
  const lines = content.split("\n");
  const wanted = new Set(headings);
  for (let i = 0; i < lines.length; i++) {
    if (wanted.has(lines[i].trim())) return i;
  }
  return -1;
}

/** Where a section found at `start` ends: the line before the next heading. */
export function sectionEnd(content: string, start: number): number {
  const lines = content.split("\n");
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) return i - 1;
  }
  return lines.length - 1;
}

export interface SectionRange {
  /** The heading's own line, 0-based. */
  from: number;
  /** The last line the section covers. */
  to: number;
}

/**
 * The ranges Obsidian needs to fold a note's non-Notes sections.
 *
 * A fold runs from the heading's line to the last line above the next one, and
 * a section with nothing under it (`to === from`) is dropped: folding an empty
 * heading does nothing visible and leaves a fold record pointing at nothing.
 */
export function foldableRanges(content: string, headings: string[][]): SectionRange[] {
  const ranges: SectionRange[] = [];
  for (const group of headings) {
    const from = headingLine(content, group);
    if (from < 0) continue;
    const to = sectionEnd(content, from);
    if (to > from) ranges.push({ from, to });
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/**
 * Drop the folds that would hide `line`, keeping every other one.
 *
 * What a jump into a section has to do before it scrolls: land on a folded
 * heading and the paragraph you asked for is not on screen at all, which reads
 * as a link that did nothing. A fold whose heading *is* the target is left
 * alone — that is the heading itself, and it is visible either way.
 */
export function foldsRevealing(folds: SectionRange[], line: number): SectionRange[] {
  return folds.filter((fold) => line <= fold.from || line > fold.to);
}

/**
 * The heading `line` sits under, or null.
 *
 * Scans upwards, so the answer costs a few lines inside a section you are
 * writing in and stops rather than reading a whole transcript backwards.
 * `maxScan` is that stop: a cursor a thousand lines below its heading is in the
 * middle of a transcript, and "which section is this?" is not a question worth
 * a full-document scan on every keystroke to answer.
 */
export function enclosingHeading(
  lineAt: (line: number) => string | undefined,
  from: number,
  maxScan = 400,
): string | null {
  const stop = Math.max(0, from - maxScan);
  for (let i = from; i >= stop; i--) {
    const text = lineAt(i);
    if (text === undefined) continue;
    if (HEADING_RE.test(text)) return text.trim();
  }
  return null;
}

/** A place in a note, the way an editor counts them. */
export interface NotePosition {
  line: number;
  ch: number;
}

/**
 * Where the cursor goes when the Notes button is pressed.
 *
 * `remembered` — the last place typing happened under this note's `# Notes` —
 * when it is still inside the section, and the line under the heading when it
 * is not. Coming back to a note should put you at the end of the sentence you
 * left, not at the top of a page of writing you then have to scroll through.
 *
 * The column is clamped to the line it lands on: notes are edited between
 * visits, and a `ch` past the end of a shortened line is a cursor Obsidian
 * puts somewhere of its own choosing.
 */
export function notesCursorTarget(
  content: string,
  headingLine: number,
  remembered: NotePosition | null,
): NotePosition {
  const lines = content.split("\n");
  const end = sectionEnd(content, headingLine);
  const start = { line: Math.min(headingLine + 1, lines.length - 1), ch: 0 };
  if (!remembered) return start;
  if (remembered.line <= headingLine || remembered.line > end) return start;
  const text = lines[remembered.line] ?? "";
  return { line: remembered.line, ch: Math.min(Math.max(0, remembered.ch), text.length) };
}

/**
 * Rewrite a note's legacy headings to the level-one names.
 *
 * Only ever run from the command of the same name — see `main.ts`. It touches
 * the four headings this plugin owns and nothing else, and it is idempotent, so
 * running it on a note that is already current returns the note unchanged.
 */
export function normaliseHeadings(content: string): string {
  const rules: Array<[string[], string]> = [
    [SECTION_HEADINGS.notes, NOTES_HEADING],
    [SECTION_HEADINGS.description, DESCRIPTION_HEADING],
    [SECTION_HEADINGS.transcript, TRANSCRIPT_HEADING],
    [HEATMAP_ALIASES, HEATMAP_HEADING],
  ];
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      for (const [aliases, canonical] of rules) {
        if (aliases.includes(trimmed)) return canonical;
      }
      return line;
    })
    .join("\n");
}
