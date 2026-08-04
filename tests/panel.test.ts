import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_MIN_POPOVER_PX,
  PANEL_POPOVER_GAP_PX,
  panelPlacement,
} from "../src/panel.ts";

test("a phone gets the sheet, whatever the room above the bar", () => {
  assert.deepEqual(panelPlacement({ sheet: true, barTop: 0 }), { mode: "sheet" });
  assert.deepEqual(panelPlacement({ sheet: true, barTop: 900 }), { mode: "sheet" });
});

test("the popover is capped at the room between the bar and the top of the screen", () => {
  assert.deepEqual(panelPlacement({ sheet: false, barTop: 500 }), {
    mode: "popover",
    maxHeight: 500 - PANEL_POPOVER_GAP_PX,
  });
});

test("a popover never gets shorter than a usable panel", () => {
  // The Preview modal's control bar sits just under the picture, which on a
  // small window is barely a hundred points down the screen.
  assert.deepEqual(panelPlacement({ sheet: false, barTop: 80 }), {
    mode: "popover",
    maxHeight: PANEL_MIN_POPOVER_PX,
  });
  assert.deepEqual(panelPlacement({ sheet: false, barTop: 0 }), {
    mode: "popover",
    maxHeight: PANEL_MIN_POPOVER_PX,
  });
});

test("a fractional bar position becomes a whole number of pixels", () => {
  const placement = panelPlacement({ sheet: false, barTop: 412.6 });
  assert.equal(placement.mode, "popover");
  assert.equal(placement.mode === "popover" && placement.maxHeight, 413 - PANEL_POPOVER_GAP_PX);
  assert.equal(Number.isInteger(placement.mode === "popover" ? placement.maxHeight : 0), true);
});

test("the phone case takes no measurement at all", () => {
  // The regression this guards: a sheet that inherited the popover's measured
  // cap would be a bottom sheet 202px tall on the very screen the cap was the
  // bug on. `mode: "sheet"` carries no height, so there is nothing to inherit.
  const placement = panelPlacement({ sheet: true, barTop: 202 });
  assert.equal("maxHeight" in placement, false);
});
