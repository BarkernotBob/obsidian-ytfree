import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceIdSet } from "../src/device-id-set.ts";

function memory(initial: string | null = null) {
  let value = initial;
  return { read: () => value, write: (v: string) => (value = v), peek: () => value };
}

test("a video with no most-replayed graph is remembered across reloads (GitHub #66 G5)", () => {
  const store = memory();
  const first = new DeviceIdSet(store);
  first.add("aaaaaaaaaaa");
  first.add("aaaaaaaaaaa");
  assert.equal(new DeviceIdSet(store).has("aaaaaaaaaaa"), true);
  assert.equal(new DeviceIdSet(store).has("bbbbbbbbbbb"), false);
  assert.equal(store.peek(), '["aaaaaaaaaaa"]');
});

test("the oldest id goes first past the limit, and bad storage is an empty set", () => {
  const set = new DeviceIdSet(memory(), 2);
  set.add("a");
  set.add("b");
  set.add("c");
  assert.deepEqual([set.has("a"), set.has("b"), set.has("c")], [false, true, true]);
  assert.equal(new DeviceIdSet(memory("{oops")).has("a"), false);
  const broken = new DeviceIdSet({ read: () => { throw new Error("no"); }, write: () => { throw new Error("no"); } });
  broken.add("x");
  assert.equal(broken.has("x"), true);
});
