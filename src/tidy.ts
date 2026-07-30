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
 *   - there is nothing under its `# Notes` heading — see `hasWriting`;
 *   - it is not open in front of you right now.
 *
 * One question decides it, and it is deliberately narrow: **did you write in
 * the Notes section?** Everything else in the file was put there by the plugin
 * — the frontmatter, the description, the transcript, the most-replayed
 * moments — and a note stuffed with all four is exactly the note this sweep
 * exists to remove. The file's modified time is not consulted either, because
 * the plugin writes to these notes itself: a transcript fetched or a heatmap
 * backfilled weeks after the fact would otherwise reset the clock on a note
 * nobody ever touched.
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
  content: string;
  /** Open in a tab at this moment. */
  open: boolean;
}

/**
 * Did the reader write in the Notes section?
 *
 * That section, and nothing else. The template writes the frontmatter; the
 * fetches write the description, the transcript and the most-replayed moments.
 * All of them can be present, long, and full of the video's own headings, and
 * the note still says nothing about whether the reader took anything from it —
 * which is the only question that decides whether it stays.
 *
 * The one uncertainty answers "keep": a note with no `# Notes` heading at all
 * is not shaped like ours, so there is no section to be empty and no judgement
 * to make.
 */
export function hasWriting(content: string): boolean {
  const from = headingLine(content, SECTION_HEADINGS.notes);
  if (from < 0) return true;

  const to = sectionEnd(content, from);
  return content
    .split("\n")
    .slice(from + 1, to + 1)
    .join("")
    .trim() !== "";
}

/** Is this note one the sweep may put in the trash? */
export function tidyable(candidate: TidyCandidate, now: Date, days: number): boolean {
  if (days <= 0 || candidate.open) return false;

  const cutoff = now.getTime() - days * 86_400_000;
  const watched = Date.parse(candidate.watchedAt ?? "");
  if (!Number.isFinite(watched) || watched > cutoff) return false;

  return !hasWriting(candidate.content);
}

export function notesToTidy(
  candidates: TidyCandidate[],
  now: Date,
  days: number,
): TidyCandidate[] {
  return candidates.filter((candidate) => tidyable(candidate, now, days));
}
