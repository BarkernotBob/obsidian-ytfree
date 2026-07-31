/**
 * The URL you hand to someone else.
 *
 * `youtu.be` rather than `youtube.com/watch?v=`: it is the form YouTube's own
 * share sheet produces, it survives being pasted into anything, and it is short
 * enough to read out. The timestamp is `?t=` in whole seconds — the only form
 * every YouTube client agrees on (`#t=`, `&start=` and `1h2m3s` are each
 * understood by some and dropped by others).
 */
const SHARE_BASE = "https://youtu.be/";

/**
 * A link to a video, optionally at a moment in it.
 *
 * Zero is not a timestamp. Sharing "from the beginning" is sharing the video,
 * so `?t=0` is never written — it would be a link that looks deliberate and
 * says nothing. Fractions are floored, because a share is a place to start
 * watching and not a splice point.
 */
export function shareUrl(videoId: string, seconds?: number | null): string {
  const id = videoId.trim();
  const at = typeof seconds === "number" && Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  return at > 0 ? `${SHARE_BASE}${id}?t=${at}` : `${SHARE_BASE}${id}`;
}
