import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeDescription, findTimestamps, linkifyTimestamps, seekLinkAt } from "../src/description.ts";

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

test("seekLinkAt finds the link whose span covers the offset", () => {
  const line = `note **[0:19](ytfree:${ID}:14)** and [2:15](ytfree:${ID}:135) later`;
  const first = line.indexOf("[0:19]");
  assert.deepEqual(seekLinkAt(line, first + 2), {
    videoId: ID,
    seconds: 14,
    from: first,
    to: first + `[0:19](ytfree:${ID}:14)`.length,
  });
  // Clicking the second link resolves the second target, not the first.
  assert.equal(seekLinkAt(line, line.indexOf("[2:15]") + 1)?.seconds, 135);
});

test("seekLinkAt covers the whole [text](url) span, ends inclusive", () => {
  const line = `[0:00](ytfree:${ID}:0)`;
  assert.equal(seekLinkAt(line, 0)?.seconds, 0);
  assert.equal(seekLinkAt(line, line.length)?.seconds, 0);
});

test("seekLinkAt returns null off the link and on non-ytfree links", () => {
  const line = `pre [0:00](ytfree:${ID}:0) post [x](https://a.b)`;
  assert.equal(seekLinkAt(line, 1), null);
  assert.equal(seekLinkAt(line, line.length - 2), null);
  assert.equal(seekLinkAt("no links here", 3), null);
});

test("escapeDescription neutralises tilde and backtick fences", () => {
  const out = escapeDescription("intro\n~~~~~~~~\nGET SMARTER SECTION\n```\ncode?");
  assert.equal(out, "intro\n\\~\\~\\~\\~\\~\\~\\~\\~\nGET SMARTER SECTION\n\\`\\`\\`\ncode?");
});

test("escapeDescription keeps description text out of the note's heading structure", () => {
  assert.equal(escapeDescription("# Chapters\n## Links"), "\\# Chapters\n\\## Links");
  assert.equal(escapeDescription("Title\n---"), "Title\n\\---");
  assert.equal(escapeDescription("Title\n==="), "Title\n\\===");
  assert.equal(escapeDescription("> quoted"), "\\> quoted");
  assert.equal(escapeDescription("see [[Note]]"), "see \\[\\[Note]]");
});

test("escapeDescription leaves ordinary text, links and lists alone", () => {
  const plain = "Get a free audio book! http://www.audible.com/Smarter\n- one\n1. two\n#SmarterEveryDay";
  assert.equal(escapeDescription(plain), plain);
});
