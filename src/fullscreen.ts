/**
 * What a press of the Fullscreen button does (GitHub #9).
 *
 * 038 let a press on a player with no media yet go ahead anyway: it awaited the
 * resolve and then forced the plugin's own CSS fullscreen, because the phone's
 * native one refuses a call made after the tap's gesture has lapsed. That late,
 * forced path is the one that left the Preview's player mis-sized and broken
 * until everything was closed — pressing Play and then Fullscreen before the
 * stream landed reached it every time.
 *
 * The rule now is the one Isaiah asked for: no fullscreen until the video has
 * resolved. A press before then waits, says so, and does nothing to the
 * player's layout. Once there is media, the press goes straight through inside
 * the tap, which is the path that has always worked mid-playback.
 */

export type FullscreenPress = "exit" | "enter" | "wait";

export interface FullscreenState {
  /** Already in either kind of fullscreen: ours, or the browser's. */
  inFullscreen: boolean;
  /** `HTMLMediaElement.readyState`: 0 until the stream's metadata has loaded. */
  readyState: number;
  /** A resolve is in flight, so whatever `readyState` says is about to change. */
  resolving: boolean;
}

export function fullscreenPress(state: FullscreenState): FullscreenPress {
  // The way out is never held up: it is how a reader gets back from anything.
  if (state.inFullscreen) return "exit";
  if (state.resolving || state.readyState < 1) return "wait";
  return "enter";
}
