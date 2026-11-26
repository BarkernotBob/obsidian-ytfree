import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { wireClearButton } from "../src/search-clear.ts";

/**
 * The × in the search boxes. The DOM is happy-dom's; the hub's own handlers
 * stand behind the `input` listener, which is why clearing must go through it.
 */

function setup(value = "") {
  const win = new Window();
  const doc = win.document;
  const input = doc.createElement("input") as unknown as HTMLInputElement;
  const button = doc.createElement("button") as unknown as HTMLElement;
  doc.body.append(input as never, button as never);
  input.value = value;
  const seen: string[] = [];
  input.addEventListener("input", () => seen.push(input.value));
  const sync = wireClearButton(input, button);
  return { win, doc, input, button, seen, sync };
}

test("hidden while the box is empty, shown once there is text", () => {
  const { win, input, button } = setup();
  assert.equal(button.hasAttribute("hidden"), true);
  input.value = "lofi";
  input.dispatchEvent(new win.Event("input") as unknown as Event);
  assert.equal(button.hasAttribute("hidden"), false);
});

test("shown straight away for a query restored into the box", () => {
  const { button } = setup("restored query");
  assert.equal(button.hasAttribute("hidden"), false);
});

test("a tap empties the box, tells its listeners, hides itself and refocuses", () => {
  const { doc, input, button, seen } = setup("a long query nobody wants to backspace");
  button.click();
  assert.equal(input.value, "");
  assert.deepEqual(seen, [""]);
  assert.equal(button.hasAttribute("hidden"), true);
  assert.equal(doc.activeElement, input);
});

test("a code-side clear is picked up by the returned sync", () => {
  const { input, button, sync } = setup("query");
  input.value = "";
  sync();
  assert.equal(button.hasAttribute("hidden"), true);
});

test("pressing the × does not take focus from the box", () => {
  const { win, button } = setup("query");
  const down = new win.MouseEvent("mousedown", { cancelable: true });
  button.dispatchEvent(down as never);
  assert.equal(down.defaultPrevented, true);
});
