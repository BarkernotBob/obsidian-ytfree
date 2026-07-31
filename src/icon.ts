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

const PATHS =
  '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/>' +
  '<path d="m10 15 5-3-5-3z"/>';

export function registerIcons(): void {
  addIcon(
    YT_ICON,
    '<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      PATHS +
      "</g>",
  );
}
