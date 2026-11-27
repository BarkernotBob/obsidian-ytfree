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
 * The player switch, as "HD" in a rounded box (Isaiah, 2026-11-26).
 *
 * The button swaps our player for YouTube's, and the reason to press it is the
 * picture. The YouTube badge said where you would go, not why you would want
 * to.
 */
export const HD_ICON = "ytfree-hd";

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

// A Lucide-proportioned box with the two letters drawn as strokes, so they
// stay crisp at 20px and take the icon colour like every other control.
const HD_PATHS =
  '<rect x="2" y="5" width="20" height="14" rx="2.5"/>' +
  '<path d="M6.5 9v6M6.5 12h4M10.5 9v6"/>' +
  '<path d="M13.5 9v6h1.75a3 3 0 0 0 0-6z"/>';

const SHARE_PATHS = '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>';

// Lucide's `search` lens and handle, with a solid play triangle centred in it
// (centroid 11,11 — the centre of the circle, so it does not look hung).
const SEARCH_YT_PATHS =
  '<circle cx="11" cy="11" r="8"/>' +
  '<path d="m21 21-4.35-4.35"/>' +
  '<path d="m9.2 7.8 5.6 3.2-5.6 3.2z" fill="currentColor" stroke-width="1.2"/>';

// Our player's transport: solid glyphs, white on the picture (Isaiah,
// 2026-11-27: "white controls and not see through").
export const PLAY_SOLID_ICON = "ytfree-play-solid";
export const PAUSE_SOLID_ICON = "ytfree-pause-solid";
export const BACK10_ICON = "ytfree-back-10";
export const FORWARD10_ICON = "ytfree-forward-10";
const PLAY_SOLID_PATHS =
  '<path d="M7 4.6v14.8a1 1 0 0 0 1.52.85l12.2-7.4a1 1 0 0 0 0-1.7L8.52 3.75A1 1 0 0 0 7 4.6z" ' +
  'fill="currentColor" stroke="none"/>';
const PAUSE_SOLID_PATHS =
  '<rect x="5.5" y="4" width="4.5" height="16" rx="1.2" fill="currentColor" stroke="none"/>' +
  '<rect x="14" y="4" width="4.5" height="16" rx="1.2" fill="currentColor" stroke="none"/>';
const TEN =
  '<text x="12" y="15.6" font-size="8.5" font-weight="700" text-anchor="middle" ' +
  'font-family="-apple-system, system-ui, sans-serif" fill="currentColor" stroke="none">10</text>';
const BACK10_PATHS =
  '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" stroke-width="2.4"/>' +
  '<path d="M6.4 1.8 5.6 6.4l4.5.9" stroke-width="2.4"/>' + TEN;
const FORWARD10_PATHS =
  '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" stroke-width="2.4"/>' +
  '<path d="m17.6 1.8.8 4.6-4.5.9" stroke-width="2.4"/>' + TEN;

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
  addIcon(HD_ICON, lucide(HD_PATHS));
  addIcon(SEARCH_YT_ICON, lucide(SEARCH_YT_PATHS));
  addIcon(PLAY_SOLID_ICON, lucide(PLAY_SOLID_PATHS));
  addIcon(PAUSE_SOLID_ICON, lucide(PAUSE_SOLID_PATHS));
  addIcon(BACK10_ICON, lucide(BACK10_PATHS));
  addIcon(FORWARD10_ICON, lucide(FORWARD10_PATHS));
}
