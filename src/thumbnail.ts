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
 * The same halfway still at 1280×720. Only HD videos have one, so it is never
 * the first thing a card asks for — see `sharperUrlFor`.
 */
export function maxresMidFrameUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxres2.jpg`;
}

/** Width of `hq2.jpg`, the picture every card starts with. */
const HQ_WIDTH = 480;

/**
 * How far `hq2` may be stretched, in screen pixels, before it is worth asking
 * for `maxres2`.
 */
const UPSCALE_LIMIT = 1.5;

/**
 * Below this CSS width a picture is a small card whatever the screen: the
 * 160 px desktop row (at any zoom) and the phone's two-up cards (about 185 px
 * even on a 4× screen). The phone's full-width Preview poster is 360+.
 */
const MIN_CSS_WIDTH = 320;

/**
 * The sharper still to try for a picture that has just loaded, or null.
 *
 * Only when what loaded is the `hq2` halfway still (not a Short, not the
 * stored fallback), it is a large picture (at least 320 CSS px), and it is
 * drawn wider, in screen pixels, than `hq2` can fill. A small card therefore
 * never spends a request on a `maxres2` that a non-HD video does not have.
 */
export function sharperUrlFor(
  loadedSrc: string,
  cssWidth: number,
  devicePixelRatio: number,
): string | null {
  const match = /^https:\/\/i\.ytimg\.com\/vi\/([^/]+)\/hq2\.jpg$/.exec(loadedSrc);
  if (!match) return null;
  if (cssWidth < MIN_CSS_WIDTH) return null;
  const screenWidth = cssWidth * (devicePixelRatio > 0 ? devicePixelRatio : 1);
  if (screenWidth <= HQ_WIDTH * UPSCALE_LIMIT) return null;
  return maxresMidFrameUrl(match[1]);
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
 *
 * Once the halfway still is showing, a large picture (see `sharperUrlFor`)
 * fetches `maxres2` off-screen and swaps it in only if it really arrived, so
 * a non-HD video keeps its `hq2` and never flashes a broken image.
 */
export function showThumbnail(img: HTMLImageElement, candidates: string[]): void {
  let index = 0;
  let upgradeTried = false;
  const next = (): void => {
    index += 1;
    if (index < candidates.length) img.src = candidates[index];
    else {
      img.onerror = null;
      img.onload = null;
    }
  };
  const startProbe = (loadedSrc: string, sharper: string): void => {
    upgradeTried = true;
    const probe = new Image();
    const swap = (): void => {
      // Still showing what we measured, still on screen, and a real frame.
      if (!img.isConnected || img.src !== loadedSrc || isPlaceholder(probe.naturalWidth)) return;
      img.onload = null;
      // Belt and braces: it just loaded, but if it fails now, go back.
      img.onerror = () => {
        img.onerror = null;
        img.src = loadedSrc;
      };
      img.src = sharper;
    };
    // Decoded before the swap, so the picture never blanks while it does.
    probe.onload = () => {
      if (typeof probe.decode === "function") probe.decode().then(swap, swap);
      else swap();
    };
    probe.src = sharper;
  };
  /** True once there is nothing left to wait for. */
  const measure = (loadedSrc: string): boolean => {
    if (upgradeTried || img.src !== loadedSrc) return true;
    if (!img.isConnected) return false;
    const sharper = sharperUrlFor(
      loadedSrc,
      img.getBoundingClientRect().width,
      window.devicePixelRatio,
    );
    if (!sharper) return false;
    startProbe(loadedSrc, sharper);
    return true;
  };
  const tryUpgrade = (loadedSrc: string): void => {
    if (measure(loadedSrc) || typeof ResizeObserver === "undefined") return;
    // Not on screen yet (a note still being rendered), or small for now: a
    // rotated phone or a widened pane can still make it large. It fires again
    // when the picture is removed (its size drops to 0), and lets go then. A
    // picture not yet attached also reports in once, and must not let go.
    let wasConnected = img.isConnected;
    const observer = new ResizeObserver(() => {
      if (img.isConnected) wasConnected = true;
      if (measure(loadedSrc) || (wasConnected && !img.isConnected)) observer.disconnect();
    });
    observer.observe(img);
  };
  img.onerror = next;
  img.onload = () => {
    if (isPlaceholder(img.naturalWidth)) next();
    else tryUpgrade(img.src);
  };
  if (candidates.length > 0) img.src = candidates[0];
}
