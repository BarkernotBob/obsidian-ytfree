/**
 * The × inside a search box.
 *
 * `type="search"` promises a native clear control, but Obsidian's iOS webview
 * draws none, so a long query had to be backspaced out a letter at a time.
 * This is that control, drawn by us so it exists on every platform.
 *
 * Clearing goes through an `input` event rather than a side door, so whatever
 * the box already does when it is emptied by hand (drop the results, go back to
 * the whole channel) happens the same way for the ×. Focus returns to the box,
 * so the keyboard is up and the next query can be typed straight away.
 *
 * Returns the show/hide check, for callers that change `value` from code
 * (which fires no event).
 */
export function wireClearButton(input: HTMLInputElement, button: HTMLElement): () => void {
  const sync = (): void => {
    const empty = input.value === "";
    button.toggleAttribute("hidden", empty);
    button.setAttribute("aria-hidden", empty ? "true" : "false");
  };

  // Keep focus in the box while the × is pressed: without this, a tap on a
  // focused box blurs it first and the iOS keyboard drops and comes back.
  button.addEventListener("pointerdown", (evt) => evt.preventDefault());
  button.addEventListener("mousedown", (evt) => evt.preventDefault());
  button.addEventListener("click", (evt) => {
    evt.preventDefault();
    if (input.value !== "") {
      input.value = "";
      // The box's own window's Event, so this holds in a pop-out window too.
      const View = input.ownerDocument.defaultView?.Event ?? Event;
      input.dispatchEvent(new View("input", { bubbles: true }));
    }
    sync();
    input.focus();
  });

  input.addEventListener("input", sync);
  sync();
  return sync;
}
