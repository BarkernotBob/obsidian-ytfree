import { test } from "node:test";
import assert from "node:assert/strict";
import { findTimestamps, linkifyTimestamps } from "../src/description.ts";

const ID = "dQw4w9WgXcQ";

test("findTimestamps reads both clock shapes", () => {
  assert.deepEqual(
    findTimestamps("0:00 Intro").map((m) => [m.text, m.seconds]),
    [["0:00", 0]],
  );
  assert.deepEqual(
    findTimestamps("12:34 middle").map((m) => m.seconds),
    [754],
  );
  assert.deepEqual(
    findTimestamps("1:02:03 late").map((m) => m.seconds),
    [3723],
  );
  // Long livestream VODs run past 99 hours.
  assert.deepEqual(
    findTimestamps("100:00:00").map((m) => m.seconds),
    [360000],
  );
});

test("findTimestamps walks a whole chapter list in order", () => {
  const chapters = ["0:00 Cold open", "2:15 The setup", "1:04:30 The payoff"].join("\n");
  assert.deepEqual(
    findTimestamps(chapters).map((m) => m.seconds),
    [0, 135, 3870],
  );
});

test("findTimestamps does not split an hh:mm:ss into a second match", () => {
  // The bug this guards: `1:02:03` also containing the substring `02:03`.
  assert.equal(findTimestamps("1:02:03").length, 1);
});

test("findTimestamps ignores things that merely look like clocks", () => {
  assert.deepEqual(findTimestamps("Subscribe at 5pm, ratio 3:70"), []);
  assert.deepEqual(findTimestamps("version 1.5:30"), []);
  assert.deepEqual(findTimestamps("no digits here"), []);
  // Minutes and seconds are both bounded, so a stray 4-digit run is not a time.
  assert.deepEqual(findTimestamps("12:345"), []);
});

test("linkifyTimestamps rewrites every match and keeps the surrounding text", () => {
  assert.equal(
    linkifyTimestamps("0:00 Intro\n2:15 Setup", ID),
    `[0:00](ytfree:${ID}:0) Intro\n[2:15](ytfree:${ID}:135) Setup`,
  );
});

test("linkifyTimestamps returns the input untouched when there is nothing to do", () => {
  const text = "A description with no chapters in it.";
  assert.equal(linkifyTimestamps(text, ID), text);
});

test("linkifyTimestamps leaves an existing markdown link alone", () => {
  // Flow-capture stamps are already links; re-linking would nest brackets.
  const text = `[1:00](ytfree:${ID}:55) my own note`;
  assert.equal(linkifyTimestamps(text, ID), text);
});
