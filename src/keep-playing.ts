/**
 * Was that pause the phone's, or the reader's?
 *
 * iOS stops a playing `<video>` on its own in three places the reader did not
 * ask it to: leaving the phone's own fullscreen, switching away from Obsidian,
 * and locking the screen. Isaiah's rule (2026-11-04) is that none of those
 * stop the video. So the player resumes a pause that lands next to one of
 * those moments, and only that pause.
 *
 * Pure, so the edges are tested here rather than on a phone. The player feeds
 * it timestamps; the order of the two events is not promised (WebKit sends the
 * pause before `webkitendfullscreen` on some builds and after it on others), so
 * "next to" means within a window either side.
 */

/** How far apart the pause and its cause can be and still be one event. */
export const SYSTEM_PAUSE_WINDOW_MS = 1000;

/**
 * A pause the reader asked for sets its mark just before calling `pause()`, so
 * the event it fires is a few milliseconds behind. Generous, because a busy
 * main thread on an old phone can stretch that.
 */
export const READER_PAUSE_MARK_MS = 400;

export interface PauseFacts {
  /** When the `pause` event fired. 0 when there is no pause to judge. */
  pauseAt: number;
  /** When the reader last asked for a pause through our controls. 0 if never. */
  readerPauseAt: number;
  /** The pause was ours, for typing. Its own idle timer brings it back. */
  pausedByTyping: boolean;
  /** When the cause happened: the document went hidden, or fullscreen ended. */
  causeAt: number;
  /** The video had reached its end. iOS fires `pause` there too. */
  ended: boolean;
}

/** Should the player press Play again for the reader? */
export function shouldResumeSystemPause(facts: PauseFacts): boolean {
  const { pauseAt, readerPauseAt, pausedByTyping, causeAt, ended } = facts;
  if (ended || pausedByTyping) return false;
  if (pauseAt <= 0 || causeAt <= 0) return false;
  if (Math.abs(pauseAt - causeAt) > SYSTEM_PAUSE_WINDOW_MS) return false;
  const readerAsked = readerPauseAt > 0 && pauseAt - readerPauseAt >= 0 && pauseAt - readerPauseAt <= READER_PAUSE_MARK_MS;
  return !readerAsked;
}
