/**
 * Thumbnails from the middle of the video, not the uploader's picture.
 *
 * YouTube saves three stills of every video, roughly a quarter, half and three
 * quarters of the way through, at `i.ytimg.com/vi/<id>/hq1.jpg`, `hq2.jpg` and
 * `hq3.jpg`. `hq2` is the halfway frame — the same trick HackerTube uses to
 * replace clickbait thumbnails with an honest one. See
 * `docs/V1-SCOPE-MIDFRAME-THUMBNAILS.md`.
 *
 * `hq2.jpg` is 480×360: a 16:9 frame letterboxed into 4:3. Both places that
 * draw a thumbnail use `object-fit: cover` on a 16:9 box, which crops exactly
 * the letterbox bars, so nothing in the stylesheet changes.
 *
 * Pure on purpose: the DOM side is `showThumbnail` below, everything it decides
 * is here and tested.
 */

/** Height and width of the grey "no such image" picture YouTube serves. */
const PLACEHOLDER_WIDTH = 120;

/** The halfway still for a video ID. */
export function midFrameUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hq2.jpg`;
}

/**
 * A portrait thumbnail URL — what YouTube hands back for a Short
 * (`oardefault`, `oar2`). A Short's stills are pillarboxed portrait frames, so
 * cropping one into a 16:9 card would show mostly black; the uploader's
 * picture stays for those.
 */
function looksPortrait(url: string): boolean {
  return /\/oar(?:default|\d)/.test(url);
}

/**
 * The pictures to try for one card, best first.
 *
 * Normally the halfway still, then the stored thumbnail if that fails. A Short
 * (or a portrait thumbnail, which means the same thing) keeps the stored one.
 * Empty when there is nothing to show at all.
 */
export function thumbnailCandidates(
  videoId: string,
  stored: string,
  isShort = false,
): string[] {
  const list: string[] = [];
  if (videoId && !isShort && !looksPortrait(stored)) list.push(midFrameUrl(videoId));
  if (stored && !list.includes(stored)) list.push(stored);
  return list;
}

/**
 * Whether a loaded image is YouTube's "missing" stand-in rather than a frame.
 *
 * i.ytimg.com does not always 404 a still it lacks; sometimes it answers with
 * a 120×90 grey picture. Nothing real is that narrow at `hq` size (480 wide).
 */
export function isPlaceholder(naturalWidth: number): boolean {
  return naturalWidth > 0 && naturalWidth <= PLACEHOLDER_WIDTH;
}

/**
 * Point an `<img>` at the first candidate, stepping to the next one on a 404
 * or the grey placeholder. Each card asks for at most one extra picture, and
 * only when the halfway still is missing.
 */
export function showThumbnail(img: HTMLImageElement, candidates: string[]): void {
  let index = 0;
  const next = (): void => {
    index += 1;
    if (index < candidates.length) img.src = candidates[index];
    else {
      img.onerror = null;
      img.onload = null;
    }
  };
  img.onerror = next;
  img.onload = () => {
    if (isPlaceholder(img.naturalWidth)) next();
  };
  if (candidates.length > 0) img.src = candidates[0];
}
