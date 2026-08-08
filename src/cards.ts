/**
 * What the four buttons on a card say, and how many cards get drawn at once.
 *
 * The rules only, so they can be tested without Obsidian. See
 * `docs/V1-SCOPE-CARD-CONTROLS.md` for why there are four of them and why they
 * are the same four in both places: a hub card and a search result each had
 * exactly one interaction — the whole card — so the only way to find out what a
 * video was, was to make a note for it.
 */

export type CardActionKey = "preview" | "watch" | "save" | "remove";

export interface CardSlot {
  key: CardActionKey;
  /** Lucide icon for the idle state. `check` and `plus` are never idle icons. */
  icon: string;
  /** The idle label. Also the accessible name, in every state. */
  label: string;
  /**
   * Already true of this video. The label stays where it is and only takes the
   * accent colour, so the button cannot change size on being pressed — a state
   * that swaps the text for something wider pushes its neighbours even inside a
   * fixed cell, which the prototype found the hard way.
   */
  done: boolean;
  /** Removing is the one action that reads red once it has happened. */
  danger?: boolean;
}

/** How much a card already knows about itself before anything is pressed. */
export interface CardFacts {
  /** A note for this video exists — the definition of Kept. */
  noteExists: boolean;
  /** The video is in the hub at all. Always true of a hub card. */
  inHub: boolean;
}

/**
 * A hub card's four.
 *
 * The positions never move. Save is the one slot that changes meaning, and only
 * where the default would be a no-op: on a Kept video the note is already
 * there, so "create it and do not open it" becomes "open it". Disabling it
 * instead would waste a quarter of the control area in half the filters.
 */
export function hubSlots(facts: CardFacts): CardSlot[] {
  return [
    { key: "preview", icon: "eye", label: "Preview", done: false },
    { key: "watch", icon: "play", label: "Watch", done: facts.noteExists },
    {
      key: "save",
      icon: facts.noteExists ? "file-text" : "bookmark-plus",
      label: facts.noteExists ? "Open note" : "Save",
      done: facts.noteExists,
    },
    { key: "remove", icon: "x", label: "Remove", done: false, danger: true },
  ];
}

/**
 * A search result's four. Same positions, different meanings underneath:
 * Save adds to the Inbox and makes no note, and Remove hides the result from
 * search rather than from the hub.
 */
export function searchSlots(facts: CardFacts): CardSlot[] {
  return [
    { key: "preview", icon: "eye", label: "Preview", done: false },
    { key: "watch", icon: "play", label: "Watch", done: facts.noteExists },
    {
      key: "save",
      icon: facts.inHub ? "bookmark-check" : "bookmark-plus",
      label: facts.inHub ? "In your hub" : "Save",
      done: facts.inHub,
    },
    { key: "remove", icon: "x", label: "Remove", done: false, danger: true },
  ];
}

/**
 * How many cards the first render draws, and each scroll after it.
 *
 * A two-up grid roughly triples the cards on screen, and the hub is thousands
 * of rows on a fresh import. Infinite scroll is only safe here because Preview
 * is a modal: the list is never unmounted, so there is no scroll position that
 * could need restoring.
 */
export const CARD_PAGE = 40;

/** How many of `total` are on screen after `pages` pages. Never past the end. */
export function shownCount(total: number, pages: number): number {
  return Math.min(total, Math.max(0, pages) * CARD_PAGE);
}

/** The bar along the bottom of a thumbnail, as a fraction of the width. */
export function watchedFraction(seconds: number, duration: number | null | undefined): number {
  if (!duration || duration <= 0 || seconds <= 0) return 0;
  return Math.min(1, seconds / duration);
}
