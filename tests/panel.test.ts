/**
 * Where the pop-out opens — 037, and the two bugs before it.
 *
 * The docked cases are the desktop's and have been right since the panel
 * existed. The anchored ones are the phone's: 032 stopped the clipping by
 * turning the panel into a bottom sheet, 037 is the report that a sheet is the
 * wrong object, and these pin the shape that answers both — a popover that
 * hangs off its button and is measured against the viewport rather than against
 * any ancestor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_EDGE_MARGIN_PX,
  PANEL_MIN_POPOVER_PX,
  PANEL_POPOVER_GAP_PX,
  anchorVisible,
  panelPlacement,
} from "../src/panel.ts";
import type { PanelRect } from "../src/panel.ts";

/** An iPhone 14, in points. */
const PHONE = { width: 390, height: 844 };

/** The pop-out button: 32pt square, last control on the bar, right-aligned. */
function button(top: number, right = 380): PanelRect {
  return { top, bottom: top + 32, left: right - 32, right };
}

/** Five rows and a footer — what the panel actually measures on a phone. */
const PANEL = { width: 232, height: 246 };

function anchored(anchor: PanelRect, panel = PANEL, viewport = PHONE) {
  const placement = panelPlacement({ anchored: true, anchor, panel, viewport });
  assert.equal(placement.mode, "anchored");
  if (placement.mode !== "anchored") throw new Error("unreachable");
  return placement;
}

// -------------------------------------------------------------- the desktop

test("the docked popover is capped at the room between the bar and the screen", () => {
  assert.deepEqual(panelPlacement({ anchored: false, barTop: 500 }), {
    mode: "docked",
    maxHeight: 500 - PANEL_POPOVER_GAP_PX,
  });
});

test("a docked popover never gets shorter than a usable panel", () => {
  // The Preview modal's control bar sits just under the picture, which on a
  // small window is barely a hundred points down the screen.
  assert.deepEqual(panelPlacement({ anchored: false, barTop: 80 }), {
    mode: "docked",
    maxHeight: PANEL_MIN_POPOVER_PX,
  });
});

test("a fractional bar position becomes a whole number of pixels", () => {
  const placement = panelPlacement({ anchored: false, barTop: 412.6 });
  assert.equal(placement.mode === "docked" && placement.maxHeight, 413 - PANEL_POPOVER_GAP_PX);
});

// ---------------------------------------------------------------- the phone

test("the panel hangs off the button, not off the foot of the screen", () => {
  // 037 in one assertion: a sheet's top is the screen height minus its own
  // height and has nothing to do with the button. This one's does.
  const placement = anchored(button(600));
  assert.equal(placement.top + placement.maxHeight + PANEL_POPOVER_GAP_PX, 600);
  assert.equal(placement.side, "up");
  assert.equal(placement.left + placement.width, 380, "right edges aligned with the button");
});

test("it opens upward when the room is above and downward when it is below", () => {
  assert.equal(anchored(button(600)).side, "up");
  const down = anchored(button(60));
  assert.equal(down.side, "down");
  assert.equal(down.top, 60 + 32 + PANEL_POPOVER_GAP_PX);
});

test("with room on both sides it opens upward", () => {
  // The button is on a control bar under the picture. Covering the picture
  // costs less than covering the text under it.
  const placement = anchored(button(400), { width: 232, height: 200 });
  assert.equal(placement.side, "up");
});

test("a panel too tall for either side takes the bigger side and scrolls", () => {
  // Landscape, where 246pt of panel does not fit above or below anything: the
  // cap can only be answered by scrolling, and it says so rather than
  // overflowing the screen the way the bar-relative cap did.
  const landscape = { width: 844, height: 390 };
  const placement = anchored(button(200, 800), PANEL, landscape);
  assert.equal(placement.side, "up");
  assert.equal(placement.maxHeight, 200 - PANEL_POPOVER_GAP_PX - PANEL_EDGE_MARGIN_PX);
  assert.ok(placement.maxHeight < PANEL.height, "it has to scroll, and it is told to");
});

test("a button low on the screen opens upward even though below is nearer", () => {
  // The Preview sheet's control bar sits under the picture with the whole
  // description below it, so "below" is where the room is — but not once the
  // bar is far enough down that the panel would run off the bottom.
  const placement = anchored(button(700));
  assert.equal(placement.side, "up");
  assert.equal(placement.maxHeight, PANEL.height, "and it fits, so it is not capped");
});

test("no edge of the panel leaves the screen, in either orientation", () => {
  const landscape = { width: 844, height: 390 };
  for (const viewport of [PHONE, landscape]) {
    for (const top of [0, 40, viewport.height / 2, viewport.height - 60, viewport.height - 32]) {
      for (const right of [40, viewport.width / 2, viewport.width - 4]) {
        const placement = anchored(button(top, right), PANEL, viewport);
        assert.ok(placement.top >= 0, `top ${placement.top} above the screen`);
        assert.ok(
          placement.top + placement.maxHeight <= viewport.height,
          `bottom ${placement.top + placement.maxHeight} below ${viewport.height}`,
        );
        assert.ok(placement.left >= PANEL_EDGE_MARGIN_PX, `left ${placement.left}`);
        assert.ok(
          placement.left + placement.width <= viewport.width - PANEL_EDGE_MARGIN_PX,
          `right ${placement.left + placement.width} past ${viewport.width}`,
        );
      }
    }
  }
});

test("a button near the left edge does not push the panel off it", () => {
  // The clamp rather than a flip: a 232pt panel on a 390pt screen has one
  // sensible left edge and jumping between two is worse than picking it.
  const placement = anchored(button(600, 60));
  assert.equal(placement.left, PANEL_EDGE_MARGIN_PX);
});

test("a panel wider than the screen is narrowed to fit it", () => {
  const placement = anchored(button(600), { width: 500, height: 200 }, PHONE);
  assert.equal(placement.width, PHONE.width - PANEL_EDGE_MARGIN_PX * 2);
  assert.equal(placement.left, PANEL_EDGE_MARGIN_PX);
});

test("the phone's keyboard shrinks the room rather than being ignored", () => {
  // `visualViewport` is what the caller passes when there is one. A panel
  // measured against `innerHeight` while the keyboard is up opens behind it.
  const shrunk = { width: 390, height: 400 };
  const placement = anchored(button(340), PANEL, shrunk);
  assert.ok(placement.top + placement.maxHeight <= shrunk.height);
});

test("chrome at the edges is room the panel does not get", () => {
  const placement = panelPlacement({
    anchored: true,
    anchor: button(700),
    panel: PANEL,
    viewport: PHONE,
    inset: { top: 500, bottom: 0 },
  });
  assert.equal(placement.mode, "anchored");
  if (placement.mode !== "anchored") return;
  assert.ok(placement.top >= 500, "opened over the chrome it was told about");
});

// ------------------------------------------------- following, and giving up

test("a button scrolled off the screen closes the panel instead of moving it", () => {
  assert.equal(anchorVisible(button(400), PHONE), true);
  assert.equal(anchorVisible(button(-40), PHONE), false, "scrolled off the top");
  assert.equal(anchorVisible(button(900), PHONE), false, "scrolled off the bottom");
  // Half on is still on: the panel follows until the button is really gone.
  assert.equal(anchorVisible(button(-16), PHONE), true);
});

test("chrome counts as off screen — a button under the toolbar is not reachable", () => {
  assert.equal(anchorVisible(button(4), PHONE, { top: 44, bottom: 48 }), false);
  assert.equal(anchorVisible(button(810), PHONE, { top: 44, bottom: 48 }), false);
});
