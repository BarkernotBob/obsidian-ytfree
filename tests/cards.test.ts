import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_PAGE, hubSlots, searchSlots, shownCount, watchedFraction } from "../src/cards.ts";
import type { CardActionKey } from "../src/cards.ts";

const POSITIONS: CardActionKey[] = ["preview", "watch", "save", "remove"];

/**
 * The positions are the contract.
 *
 * Two of the four slots change meaning where the default would be a no-op, and
 * the whole reason that is allowed is that they never move: a control area you
 * can learn by position stops being one the moment a filter reorders it.
 */
test("the four positions never move, in either list", () => {
  for (const facts of [
    { inHub: false, noteExists: false },
    { inHub: true, noteExists: false },
    { inHub: true, noteExists: true },
  ]) {
    assert.deepEqual(
      hubSlots(facts).map((slot) => slot.key),
      POSITIONS,
    );
    assert.deepEqual(
      searchSlots(facts).map((slot) => slot.key),
      POSITIONS,
    );
  }
});

test("a hub card with no note offers Save, and does not read as done", () => {
  const [, watch, save] = hubSlots({ inHub: true, noteExists: false });
  assert.equal(save.label, "Save");
  assert.equal(save.done, false);
  assert.equal(watch.done, false);
});

test("a Kept video's Save slot reads done without changing its words", () => {
  // It opens the note rather than making one, but the label and the icon are
  // the same ones — the accent colour is the whole of the difference. The
  // label is on screen in every state now, so a longer word in a 96px cell
  // both clips and reads as a different button.
  const [, watch, save] = hubSlots({ inHub: true, noteExists: true });
  const [, , idle] = hubSlots({ inHub: true, noteExists: false });
  assert.equal(save.label, "Save");
  assert.equal(save.label, idle.label);
  assert.equal(save.icon, idle.icon);
  assert.equal(save.done, true);
  // Watch reads done for the same fact — a note exists.
  assert.equal(watch.done, true);
});

test("a search result already in the hub reads done on the Save slot", () => {
  const notThere = searchSlots({ inHub: false, noteExists: false });
  assert.equal(notThere[2].label, "Save");
  assert.equal(notThere[2].done, false);

  const there = searchSlots({ inHub: true, noteExists: false });
  assert.equal(there[2].label, "Save");
  assert.equal(there[2].icon, notThere[2].icon);
  assert.equal(there[2].done, true);
});

/**
 * An icon no longer changes with the state, so no icon may *be* a state: a bare
 * `plus` or `check` on a button that has not been pressed claims something that
 * has not happened.
 */
test("no icon is a bare plus or check", () => {
  for (const facts of [
    { inHub: false, noteExists: false },
    { inHub: true, noteExists: true },
  ]) {
    for (const slot of [...hubSlots(facts), ...searchSlots(facts)]) {
      assert.ok(slot.icon !== "plus" && slot.icon !== "check", slot.icon);
    }
  }
});

test("Remove is the only slot that reads as dangerous", () => {
  const facts = { inHub: true, noteExists: false };
  const danger = hubSlots(facts).filter((slot) => slot.danger);
  assert.deepEqual(
    danger.map((slot) => slot.key),
    ["remove"],
  );
});

test("paging never draws past the end of the list", () => {
  assert.equal(shownCount(1000, 1), CARD_PAGE);
  assert.equal(shownCount(1000, 3), CARD_PAGE * 3);
  assert.equal(shownCount(12, 1), 12);
  assert.equal(shownCount(12, 9), 12);
  assert.equal(shownCount(0, 1), 0);
  // A page count that has not been incremented yet must not draw a negative
  // slice — `slice(0, -40)` would silently drop the tail of the list.
  assert.equal(shownCount(50, 0), 0);
  assert.equal(shownCount(50, -1), 0);
});

test("the watched line is a fraction, and a missing duration draws nothing", () => {
  assert.equal(watchedFraction(0, 600), 0);
  assert.equal(watchedFraction(300, 600), 0.5);
  assert.equal(watchedFraction(60, undefined), 0);
  assert.equal(watchedFraction(60, null), 0);
  assert.equal(watchedFraction(60, 0), 0);
  // A position past the end — a duration that was revised down — is a full
  // line, never a line wider than the picture.
  assert.equal(watchedFraction(900, 600), 1);
});
