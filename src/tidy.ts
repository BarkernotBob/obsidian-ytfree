/**
 * Video notes you watched and never wrote in.
 *
 * A video note is created by the click that opens the video, before you know
 * whether the video was worth anything. Most are not: you watch it, you take
 * nothing from it, and the note stays in the vault forever as a stub with a
 * title, a description and an empty Notes section. Left alone the vault fills
 * with the ones that did not matter, and the ones that did are harder to find
 * among them.
 *
 * So a note is removed when all of this is true, and never otherwise:
 *
 *   - the video was actually played, and the last play was over a month ago
 *     (`watchedAt`, from the progress file — a note nobody has watched is a
 *     queue entry, not litter, and is left where it is);
 *   - the file has not been edited since then either;
 *   - nothing has been written in it — see `hasWriting`, which is deliberately
 *     eager to say yes;
 *   - it is not open in front of you right now.
 *
 * "Removed" means Obsidian's own trash — the setting the user chose for deleted
 * files, system bin or `.trash` — so a wrong answer here costs an undo, not a
 * note. Nothing in this file deletes anything; it decides, and `main.ts` acts.
 *
 * Pure and platform-neutral, like `sections.ts` and `progress.ts`: no
 * `obsidian` import, so every rule is testable under plain `node --test`.
 */

import { SECTION_HEADINGS, headingLine, sectionEnd } from "./sections.ts";

/** The default month, in days. */
export const DEFAULT_TIDY_DAYS = 30;

/** One note the sweep is looking at, with everything the rules need. */
export interface TidyCandidate {
  path: string;
  videoId: string;
  /** ISO of the last time this video was played, or null if it never was. */
  watchedAt: string | null;
  /** Vault mtime, ms since the epoch. */
  modifiedAt: number;
  content: string;
  /** Does the frontmatter carry a tag? Filing a note is writing in it. */
  tagged: boolean;
  /** Open in a tab at this moment. */
  open: boolean;
}

/** The line after the closing `---`, or 0 when there is no frontmatter. */
function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return 0;
}

/**
 * Has anyone written anything in this note?
 *
 * Every uncertainty answers yes. A note with no `# Notes` heading is not one of
 * ours to judge; anything above the first heading is someone's own text in a
 * place the template never writes to; a tag is a filing decision. Only the
 * exact shape the template produces — frontmatter, an empty Notes section, and
 * whatever the description and transcript sections were given — is writing-free.
 *
 * The description, transcript and heatmap sections are not read at all. They are
 * written by the plugin, so their content says nothing about whether the reader
 * did anything, and a description full of the video's own chapter headings must
 * not be mistaken for notes.
 */
export function hasWriting(content: string, tagged = false): boolean {
  if (tagged) return true;

  const lines = content.split("\n");
  const from = headingLine(content, SECTION_HEADINGS.notes);
  if (from < 0) return true;
  if (lines.slice(frontmatterEnd(lines), from).join("").trim() !== "") return true;

  const to = sectionEnd(content, from);
  return lines.slice(from + 1, to + 1).join("").trim() !== "";
}

/** Is this note one the sweep may put in the trash? */
export function tidyable(candidate: TidyCandidate, now: Date, days: number): boolean {
  if (days <= 0 || candidate.open) return false;

  const cutoff = now.getTime() - days * 86_400_000;
  const watched = Date.parse(candidate.watchedAt ?? "");
  if (!Number.isFinite(watched) || watched > cutoff) return false;
  // An edit is the reader touching the note, whether or not it left words
  // behind — a file saved yesterday has not been abandoned for a month.
  if (!Number.isFinite(candidate.modifiedAt) || candidate.modifiedAt > cutoff) return false;

  return !hasWriting(candidate.content, candidate.tagged);
}

export function notesToTidy(
  candidates: TidyCandidate[],
  now: Date,
  days: number,
): TidyCandidate[] {
  return candidates.filter((candidate) => tidyable(candidate, now, days));
}
