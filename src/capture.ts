/**
 * Pure decision logic for flow capture (issue 001).
 *
 * Kept free of Obsidian and DOM types on purpose: the gate below is the part
 * most likely to break, so it has to be unit-testable without an editor.
 *
 * The trigger is the *first character typed on a line*, not Enter. Enter was
 * the original design and it was wrong twice: the first line of a note never
 * got stamped (you don't press Enter to reach it), and having Enter both break
 * the line and write text raced with the typing that followed. One trigger,
 * one moment: you start writing a thought, the thought gets its timestamp.
 */

export interface StampGateInput {
  /** The `autoStampNewLine` setting. */
  enabled: boolean;
  /** A ytfree player exists in the note being edited. */
  hasPlayer: boolean;
  /** That player has been started at least once in this session. */
  hasPlayed: boolean;
  /** Full text of the line the cursor sits on. */
  lineText: string;
  /** The cursor is inside a fenced code block. */
  insideCodeBlock: boolean;
}

/**
 * Whitespace, block quotes, list bullets, checkboxes and heading markers may sit
 * before the stamp — a line is still "new" when it is only a bullet so far.
 * Anything else means the line already has content.
 */
const LINE_PREFIX =
  /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}[ \t]+)?$/;

/**
 * Typing one of these as the first character of a line is starting a bullet,
 * not starting a thought. Stamping there produced `[3:05](…) -`, which Obsidian
 * never renders as a list. The bullet is typed clean; the stamp arrives with the
 * first word after it instead.
 */
const LIST_MARKERS = new Set(["-", "*", "+"]);

/**
 * Shift a captured position back by the lookback offset.
 *
 * You decide something is worth noting several seconds after you hear it, so a
 * raw capture always lands past the thing you wanted. Floored at 0 so the start
 * of a video can never produce a negative seek target.
 */
export function applyLookback(currentTime: number, lookbackSeconds: number): number {
  const now = Math.floor(Number.isFinite(currentTime) ? currentTime : 0);
  const back = Math.max(0, Math.floor(Number.isFinite(lookbackSeconds) ? lookbackSeconds : 0));
  return Math.max(0, now - back);
}

/** Our timestamps are the only thing in a note using the `ytfree:` scheme. */
export function lineHasTimestamp(lineText: string): boolean {
  return lineText.includes("ytfree:");
}

/**
 * Where to put the stamp for a keystroke landing at `cursorCh`, or null when
 * this keystroke is not the start of a new line.
 *
 * On a bulleted line the answer is the first *word* character, not the first
 * keystroke: `-` and the space after it are typed clean so Obsidian renders the
 * list, and the stamp lands with the text that follows.
 *
 * Null for the overwhelming majority of keystrokes — every character after the
 * first one on a line — so this is the cheap check that runs first.
 */
export function stampInsertOffset(
  lineText: string,
  cursorCh: number,
  typedText: string,
): number | null {
  if (cursorCh < 0 || cursorCh > lineText.length) return null;
  if (!typedText) return null;
  if (LIST_MARKERS.has(typedText[0])) return null;
  // Whitespace is never the start of a thought. Without this, the space after a
  // bullet would take the stamp and leave `- [3:05](…) ` with the text after it.
  if (!typedText.trim()) return null;
  if (lineHasTimestamp(lineText)) return null;
  // Typing into the middle of a line that already has content is editing, not
  // starting a thought.
  if (lineText.slice(cursorCh).trim() !== "") return null;
  if (!LINE_PREFIX.test(lineText.slice(0, cursorCh))) return null;
  return cursorCh;
}

/**
 * The gate for auto-stamping.
 *
 * Deliberately says nothing about whether the video is playing. It can't:
 * pause-while-typing means the player is paused for most of the time you are
 * actually writing, and the user may also pause by hand to think. "Where the
 * video is right now" is well defined in every one of those states, so
 * play/pause is simply not part of the decision.
 *
 * `hasPlayed` is the one guard kept, and only to stop a note whose video was
 * never started from stamping every line 0:00.
 */
export function shouldAutoStamp(input: StampGateInput): boolean {
  if (!input.enabled) return false;
  if (!input.hasPlayer) return false;
  if (!input.hasPlayed) return false;
  if (input.insideCodeBlock) return false;
  if (lineHasTimestamp(input.lineText)) return false;
  return true;
}

/**
 * Whether `lineIndex` sits inside a fenced code block.
 *
 * Broader than strictly required — it covers every fence, not just ` ```ytfree `
 * — because stamping inside *any* code block is wrong for the same reason.
 */
export function isInsideCodeBlock(lines: string[], lineIndex: number): boolean {
  let openMarker: string | null = null;
  const last = Math.min(lineIndex, lines.length - 1);
  for (let i = 0; i <= last; i++) {
    const match = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (!match) continue;
    const marker = match[1][0];
    if (openMarker === null) openMarker = marker;
    else if (marker === openMarker) openMarker = null;
  }
  return openMarker !== null;
}
