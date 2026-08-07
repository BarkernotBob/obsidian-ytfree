/**
 * Where the player's pop-out opens, and how tall it is allowed to be.
 *
 * Two shapes, and the choice between them is not decoration.
 *
 * **Docked** — the desktop's. Absolutely positioned out of the control bar,
 * opening upwards over the picture, capped at the room between the bar and the
 * top of the screen. Its coordinates are the bar's, so it moves with the bar
 * for free and needs no maintenance while it is open.
 *
 * **Anchored** — the phone's. Positioned against the *viewport* — `position:
 * fixed`, coordinates measured from the button's own rect — so no ancestor's
 * `overflow` can cut it, while it still hangs off the button that opened it.
 *
 * ## Why the docked shape is not enough
 *
 * Inside the Preview modal the docked popover was clipped: the cap measures the
 * distance from the control bar to the top of the *screen*, but the panel is
 * clipped by the nearest scrolling ancestor, which in a modal is the sheet's
 * own scroller — its top edge is the top of the video, a couple of hundred
 * points lower. Five rows plus the footer is ~246px; a 92vw phone modal gives
 * the video ~202px; the difference went off the top and could not be scrolled
 * to, because the thing that clipped it was not the thing that scrolled.
 *
 * Raising the cap cannot fix that — no height fits inside a box shorter than
 * one row of the panel.
 *
 * ## Why it is not a bottom sheet either
 *
 * 032 answered the clipping by making the phone's pop-out a sheet fixed to the
 * foot of the screen, which cannot be clipped because it is not positioned
 * against anything that clips. That closed the bug and lost the thing. A
 * popover anchored to the button says *these controls belong to that button*; a
 * sheet rising from the bottom of the screen says nothing about where it came
 * from, and inside the Preview window — itself a panel, not the whole screen —
 * it reads as a second unrelated surface laid over the first (037).
 *
 * So: keep `position: fixed`, which is what actually escaped the clip, and
 * spend the coordinates on the button instead of on the bottom of the screen.
 * Nothing in Obsidian's modal chain has a transform, a filter or `contain`, so
 * "fixed" really does mean the viewport — verified against `app.css`: neither
 * `.modal-container` nor `.modal` sets one.
 *
 * The cost of leaving the ancestor's coordinate space is that the panel no
 * longer moves when the surface behind it scrolls. That is `panelPlacement`
 * being called again on every scroll and resize, and `anchorVisible` deciding
 * when the button has gone far enough that repositioning is the wrong answer
 * and closing is the right one.
 */

/** A popover never gets shorter than this while the screen can afford it. */
export const PANEL_MIN_POPOVER_PX = 160;

/** Air between a popover's near edge and the button it hangs off. */
export const PANEL_POPOVER_GAP_PX = 12;

/** Air between a popover and the edge of the screen it would otherwise touch. */
export const PANEL_EDGE_MARGIN_PX = 8;

/** A rectangle in viewport coordinates — a `DOMRect`, or a test's stand-in. */
export interface PanelRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Which shape, and everything that shape needs to be placed.
 *
 * A union rather than one bag of optional fields: the two modes are measured
 * against different things — a bar and a viewport — and nothing that places one
 * of them has any use for the other's numbers.
 *
 * The shape is decided by the platform rather than by measurement: an anchored
 * popover is what a phone should have whether or not the docked one would have
 * fitted, and a rule that flips on a measurement is a rule that flips halfway
 * through a rotation.
 */
export type PanelRoom =
  | {
      anchored: false;
      /** Viewport-relative top edge of the control bar the pop-out hangs off. */
      barTop: number;
    }
  | {
      anchored: true;
      /** Viewport-relative rect of the button the pop-out hangs off. */
      anchor: PanelRect;
      /** What the panel wants to be, measured with no cap applied. */
      panel: { width: number; height: number };
      /** The visible viewport. */
      viewport: { width: number; height: number };
      /**
       * Chrome overlapping the viewport at top and bottom — a phone's safe
       * area, and Obsidian's own mobile toolbar. Room is what is left.
       */
      inset?: { top: number; bottom: number };
    };

export type PanelPlacement =
  /** Over the picture, in the bar's own coordinates, with a measured ceiling. */
  | { mode: "docked"; maxHeight: number }
  /** Fixed to the viewport, beside the button, with a measured ceiling. */
  | {
      mode: "anchored";
      left: number;
      top: number;
      width: number;
      maxHeight: number;
      /** Which way it opened, so the caller can point a shadow at the button. */
      side: "up" | "down";
    };

function clamp(value: number, low: number, high: number): number {
  // `low` wins when the two cross, which is the case where the panel is wider
  // than the room: hanging off the right edge is recoverable by scrolling
  // nothing, hanging off the left edge cuts the labels.
  return Math.max(low, Math.min(high, value));
}

export function panelPlacement(room: PanelRoom): PanelPlacement {
  if (!room.anchored) {
    return {
      mode: "docked",
      maxHeight: Math.max(PANEL_MIN_POPOVER_PX, Math.round(room.barTop) - PANEL_POPOVER_GAP_PX),
    };
  }

  const inset = room.inset ?? { top: 0, bottom: 0 };
  const gap = PANEL_POPOVER_GAP_PX;
  const margin = PANEL_EDGE_MARGIN_PX;

  const above = room.anchor.top - inset.top - gap - margin;
  const below = room.viewport.height - inset.bottom - room.anchor.bottom - gap - margin;

  // Upward by preference — the button lives on a control bar under the picture,
  // and a menu that covers the picture covers less than one that covers the
  // text you were reading. Downward only when up will not hold it and down
  // will, and when neither will, whichever side has more.
  const side: "up" | "down" =
    above >= room.panel.height ? "up" : below >= room.panel.height ? "down" : above >= below ? "up" : "down";

  const available = Math.max(0, side === "up" ? above : below);
  const height = Math.round(Math.min(room.panel.height, available));

  const width = Math.round(Math.min(room.panel.width, room.viewport.width - margin * 2));
  // Right edges aligned: the pop-out button is the last control on the bar, so
  // its right edge is the one the panel shares. Clamped rather than flipped —
  // flipping a panel that is nearly as wide as the screen only moves which edge
  // it runs past, and the clamp reaches the same answer without the jump.
  const left = clamp(room.anchor.right - width, margin, room.viewport.width - margin - width);

  const top = side === "up" ? room.anchor.top - gap - height : room.anchor.bottom + gap;

  return { mode: "anchored", left, top: Math.round(top), width, maxHeight: height, side };
}

/**
 * Is the button still on screen, and far enough from the edges to hang a panel
 * off?
 *
 * A fixed panel does not travel with its anchor, so an open pop-out has to be
 * re-placed as the surface behind it scrolls. Past a point that stops being
 * sensible: once the button has left the visible area, "reposition" would park
 * the panel over unrelated content with nothing to explain it, and closing is
 * the honest answer.
 */
export function anchorVisible(
  anchor: PanelRect,
  viewport: { height: number },
  inset: { top: number; bottom: number } = { top: 0, bottom: 0 },
): boolean {
  return anchor.bottom > inset.top && anchor.top < viewport.height - inset.bottom;
}
