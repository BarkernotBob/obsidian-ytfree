/**
 * Pure decision logic for flow capture (issue 001).
 *
 * Kept free of Obsidian and DOM types on purpose: the gate below is the part
 * most likely to break, so it has to be unit-testable without an editor.
 */

export interface StampGateInput {
  /** The `autoStampNewLine` setting. */
  enabled: boolean;
  /** A ytfree player exists in the note being edited. */
  hasPlayer: boolean;
  /** That player is actually playing right now. */
  isPlaying: boolean;
  /** That player is paused, and *we* paused it because the user is typing. */
  pausedByTyping: boolean;
  /** Full text of the line the cursor sits on. */
  lineText: string;
  /** The cursor is inside a fenced code block. */
  insideCodeBlock: boolean;
}

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
 * Whether `lineIndex` sits inside a fenced code block.
 *
 * Broader than strictly required — it covers every fence, not just ` ```ytfree `
 * — because stamping inside *any* code block is wrong for the same reason.
 * The cursor's own line is included in the scan: pressing Enter on the opening
 * fence line puts the new line inside the block.
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

/**
 * The gate for auto-stamping a new line.
 *
 * The subtle one is `pausedByTyping`. With pause-while-typing on — the default —
 * the player is already paused by the time Enter arrives, so gating on
 * `isPlaying` alone would silently disable auto-stamp in the default
 * configuration. Both states have to count as "actively watching".
 */
export function shouldAutoStamp(input: StampGateInput): boolean {
  if (!input.enabled) return false;
  if (!input.hasPlayer) return false;
  if (!input.isPlaying && !input.pausedByTyping) return false;
  if (input.insideCodeBlock) return false;
  if (lineHasTimestamp(input.lineText)) return false;
  return true;
}
