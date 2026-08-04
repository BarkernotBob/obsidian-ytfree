import { addIcon } from "obsidian";

/**
 * Obsidian's bundled Lucide set dropped the brand icons, `youtube` among them,
 * so every `setIcon(el, "youtube")` silently rendered nothing — a blank ribbon
 * button and a blank "Search YouTube" button. We ship the shape ourselves.
 *
 * `addIcon` drops the string into an svg with `viewBox="0 0 100 100"`, so the
 * 24-unit Lucide path is scaled up (100 / 24) — the group transform scales the
 * stroke with it, so the declared width stays the Lucide 2.
 */
export const YT_ICON = "ytfree-youtube";

/**
 * Share, as a curved arrow leaving to the right — the shape YouTube uses.
 *
 * Not Lucide's `share`, which is a box with an arrow rising out of it: at 20px
 * on a control bar that is the same silhouette as `download` two buttons along,
 * and the two mean opposite things. This one is unmistakably an arrow going
 * away, so the pair can never be confused at a glance.
 */
export const SHARE_ICON = "ytfree-share";

/**
 * Search YouTube, as a lens with a play triangle in it.
 *
 * The button that opens the search screen used to be the plain YouTube badge —
 * the same glyph as the ribbon icon and the hub's own tab icon, so it said
 * "YouTube" three times and "search" nowhere. It is now this shape *and* the
 * words, because a 20px glyph on its own is not what tells you a button goes
 * somewhere. Same reasoning as the share icon above: a symbol that can be read
 * as something else is a symbol worth replacing.
 *
 * The triangle is filled rather than stroked. At 20px a stroked triangle inside
 * a stroked circle is two outlines a pixel apart and reads as noise; a solid one
 * reads as a play button at any size the plugin uses.
 */
export const SEARCH_YT_ICON = "ytfree-search-youtube";

const PATHS =
  '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/>' +
  '<path d="m10 15 5-3-5-3z"/>';

const SHARE_PATHS = '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>';

// Lucide's `search` lens and handle, with a solid play triangle centred in it
// (centroid 11,11 — the centre of the circle, so it does not look hung).
const SEARCH_YT_PATHS =
  '<circle cx="11" cy="11" r="8"/>' +
  '<path d="m21 21-4.35-4.35"/>' +
  '<path d="m9.2 7.8 5.6 3.2-5.6 3.2z" fill="currentColor" stroke-width="1.2"/>';

/**
 * `addIcon` drops the string into an svg with `viewBox="0 0 100 100"`, so the
 * 24-unit Lucide path is scaled up (100 / 24) — the group transform scales the
 * stroke with it, so the declared width stays the Lucide 2.
 */
function lucide(paths: string): string {
  return (
    '<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    paths +
    "</g>"
  );
}

export function registerIcons(): void {
  addIcon(YT_ICON, lucide(PATHS));
  addIcon(SHARE_ICON, lucide(SHARE_PATHS));
  addIcon(SEARCH_YT_ICON, lucide(SEARCH_YT_PATHS));
}
