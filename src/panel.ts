/**
 * Where the player's pop-out opens, and how tall it is allowed to be.
 *
 * Two shapes, and the choice between them is not decoration.
 *
 * **Popover** — the desktop's. Absolutely positioned out of the control bar,
 * opening upwards over the picture, capped at the room between the bar and the
 * top of the screen.
 *
 * **Sheet** — the phone's. Fixed to the bottom of the viewport, full width,
 * capped at a fraction of the screen and scrolling inside that.
 *
 * The popover was the only shape, and inside the Preview modal it was clipped:
 * the cap measures the distance from the control bar to the top of the *screen*,
 * but the panel is clipped by the nearest scrolling ancestor, which in a modal
 * is the sheet's own scroller — its top edge is the top of the video, a couple
 * of hundred points lower. Five rows plus the footer is ~246px; a 92vw phone
 * modal gives the video ~202px; the difference went off the top and could not
 * be scrolled to, because the thing that clipped it was not the thing that
 * scrolled.
 *
 * Raising the cap cannot fix that — no height fits inside a box shorter than
 * one row of the panel. A fixed element is not clipped by an ancestor's
 * overflow at all, so on a phone the panel stops being a popover. That also
 * matches the hub: one overlay, a fixed fraction of the screen, scrolling
 * internally, never resizing under a thumb (docs/MOBILE-UX.md §1).
 */

/** The sheet's share of the screen. The hub's disclosure panel uses the same. */
export const PANEL_SHEET_VH = 62;

/** A popover never gets shorter than this, even with nothing above the bar. */
export const PANEL_MIN_POPOVER_PX = 160;

/** Air between a popover's top edge and the top of the screen. */
export const PANEL_POPOVER_GAP_PX = 12;

export interface PanelRoom {
  /**
   * The phone's shape. Decided by the platform rather than by measurement: a
   * sheet is what a phone should have whether or not this particular panel
   * would have fitted, and a rule that flips on a measurement is a rule that
   * flips halfway through a rotation.
   */
  sheet: boolean;
  /** Viewport-relative top edge of the control bar the pop-out hangs off. */
  barTop: number;
}

export type PanelPlacement =
  /** Fixed to the bottom of the viewport. The stylesheet owns the height. */
  | { mode: "sheet" }
  /** Over the picture, with a measured ceiling in pixels. */
  | { mode: "popover"; maxHeight: number };

export function panelPlacement(room: PanelRoom): PanelPlacement {
  if (room.sheet) return { mode: "sheet" };
  return {
    mode: "popover",
    maxHeight: Math.max(PANEL_MIN_POPOVER_PX, Math.round(room.barTop) - PANEL_POPOVER_GAP_PX),
  };
}
