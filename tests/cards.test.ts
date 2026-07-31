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

test("a Kept video's Save slot becomes Open note", () => {
  const [, watch, save] = hubSlots({ inHub: true, noteExists: true });
  assert.equal(save.label, "Open note");
  assert.equal(save.done, true);
  // Watch carries the checkmark for the same fact — a note exists.
  assert.equal(watch.done, true);
});

test("a search result already in the hub says so on the Save slot", () => {
  const notThere = searchSlots({ inHub: false, noteExists: false });
  assert.equal(notThere[2].label, "Save");
  assert.equal(notThere[2].done, false);

  const there = searchSlots({ inHub: true, noteExists: false });
  assert.equal(there[2].label, "In your hub");
  assert.equal(there[2].done, true);
});

/**
 * `plus` and `check` are deliberately not idle icons: both now mean done, and
 * an idle button wearing one would claim something that has not happened.
 */
test("no idle icon is plus or check", () => {
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
