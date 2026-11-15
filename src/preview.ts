/**
 * What happens to the Preview sheet's player when the sheet goes away.
 *
 * It used to be one answer: destroy it. That is right for most of the ways a
 * sheet closes and wrong for the one BarkernotBob hit — press Picture-in-Picture,
 * dismiss the sheet, and the floating window dies with it, so previewing in PiP
 * is only possible for as long as you are looking at the thing PiP exists to
 * let you stop looking at.
 *
 * The rule has three cases and only one of them keeps playing.
 *
 * **Handing over beats everything.** Pressing *Watch* closes the sheet and then
 * opens the note, and the note mounts a player for the same video: one player
 * at a time is the contract 024 established, and it is also what makes "preview
 * a bit, then Watch" resume at the right second — the teardown is what writes
 * the position the note is about to read. A preview left alive in PiP would be
 * a second stream of the same video with a stale position behind it. *Remove*
 * closes the sheet too, and a video you have just discarded is not one to carry
 * on playing in a floating window.
 *
 * **Otherwise, PiP is the whole signal.** The reader has already asked for this
 * video to be somewhere other than the sheet; closing the sheet is not a second
 * decision about the video. Nothing else keeps playing — a sheet dismissed with
 * the video inline is a sheet dismissed, and leaving audio running out of a
 * window nobody can see is how you get a plugin people uninstall.
 */

export type PreviewCloseAction = "keep-playing" | "destroy";

export interface PreviewCloseState {
  /** This video owns the Picture-in-Picture window at the moment of closing. */
  pictureInPicture: boolean;
  /**
   * The sheet is closing because one of its own buttons asked it to, and
   * something else is about to take the video over — Watch, or Remove.
   */
  handingOver: boolean;
}

export function previewCloseAction(state: PreviewCloseState): PreviewCloseAction {
  if (state.handingOver) return "destroy";
  return state.pictureInPicture ? "keep-playing" : "destroy";
}

/** Whose channel Preview's channel name opens. */
export interface ChannelRef {
  channelId: string;
  channelTitle: string;
}

/**
 * The channel behind Preview's channel name (2026-11-14).
 *
 * A video can reach Preview with a channel name and no channel id: a note-only
 * card, a History card, or a search result whose byline carried no link. The
 * name used to be plain text then, so a tap did nothing. Now the id is looked
 * up on the tap (one player call, the same one a note's channel row makes)
 * and only a video YouTube will not attribute has nowhere to go.
 */
export async function resolvePreviewChannel(
  known: ChannelRef,
  lookup: () => Promise<ChannelRef>,
): Promise<ChannelRef | null> {
  if (known.channelId) return known;
  const found = await lookup().catch(() => null);
  if (!found?.channelId) return null;
  return { channelId: found.channelId, channelTitle: found.channelTitle || known.channelTitle };
}
