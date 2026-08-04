/**
 * What the search screen says, in every state it can be in.
 *
 * Pure, so the wording is a thing with tests rather than six string literals
 * scattered through two render methods in `hub.ts`. It was the second: the
 * status line and the empty block were written independently and disagreed —
 * one said "No results.", the other said "Nothing found for “x”." for the same
 * moment, and neither said what to do about it.
 *
 * Two surfaces, one answer. `status` is the reserved one-line strip under the
 * controls, which is always present and must stay short enough not to wrap.
 * `headline` and `help` are the big block drawn where the results would be,
 * which has room to explain itself. `kind` is what the caller maps to an icon —
 * icon names live in `icon.ts`, which imports `obsidian`, so they stay out of
 * here and out of the tests.
 */

export type SearchScreenKind =
  /** Nothing searched for yet — the screen you land on. */
  | "idle"
  /** A first page is in flight and there is nothing to show behind it. */
  | "loading"
  /** The request failed. The only state that offers a way to try again. */
  | "error"
  /** YouTube answered, with nothing. */
  | "none"
  /** YouTube answered, and every result was already in the hub. */
  | "allInHub"
  /** There are results. The block is not drawn; the cards are. */
  | "results";

export interface SearchScreenInput {
  /** The query behind what is on screen, or null before the first search. */
  query: string | null;
  state: "idle" | "loading" | "error";
  /** The failure text, when `state` is "error". */
  error: string;
  /** How many results are on screen. */
  results: number;
  /** How many were dropped for already being in the hub. */
  skipped: number;
  /** Any filter away from its default — worth saying, because it narrows. */
  filtersSet: boolean;
}

export interface SearchScreenCopy {
  kind: SearchScreenKind;
  /** One line, reserved height, never wraps. */
  status: string;
  /** The block's first line. Empty when `kind` is "results". */
  headline: string;
  /** The block's second line — what to do next. May be empty. */
  help: string;
  /** Whether the block offers "Try again". */
  retry: boolean;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Curly quotes, because the query is being repeated back rather than quoted. */
const quoted = (text: string): string => `“${text}”`;

export function searchScreen(input: SearchScreenInput): SearchScreenCopy {
  if (input.state === "error") {
    return {
      kind: "error",
      status: `Search failed — ${input.error}`,
      headline: "Search failed",
      // The reason, verbatim. "Something went wrong" is the one message that
      // cannot be acted on, and offline is the common case here.
      help: input.error || "YouTube did not answer. Check your connection and try again.",
      retry: true,
    };
  }

  if (input.query === null) {
    return {
      kind: "idle",
      status: input.filtersSet
        ? "Filters set · type a search and press Enter"
        : "Type a search and press Enter",
      headline: "Search all of YouTube",
      // The reassurance belongs here and not in the status line: this is the
      // screen's one claim worth making, and it needs more than a strip.
      help: "No ads, no recommendations, and nothing here plays. Pick a result and it lands in your hub.",
      retry: false,
    };
  }

  if (input.state === "loading" && input.results === 0) {
    return {
      kind: "loading",
      status: `Searching for ${quoted(input.query)}…`,
      headline: "Searching YouTube…",
      help: "",
      retry: false,
    };
  }

  if (input.results === 0) {
    // "Found nothing" and "found nothing you have not already dealt with" are
    // different answers, and only the first is worth rewording the query over.
    if (input.skipped > 0) {
      return {
        kind: "allInHub",
        status: `${plural(input.skipped, "result")} · all already in your hub`,
        headline: "You already have all of these",
        help: `Every result for ${quoted(input.query)} is already in your hub — saved, kept, or hidden.`,
        retry: false,
      };
    }
    return {
      kind: "none",
      status: `Nothing found for ${quoted(input.query)}`,
      headline: `Nothing found for ${quoted(input.query)}`,
      help: input.filtersSet
        ? "Try fewer words, or loosen the filters above."
        : "Try fewer words, or a different spelling.",
      retry: false,
    };
  }

  const skipped = input.skipped > 0 ? ` · ${input.skipped} already in your hub` : "";
  return {
    kind: "results",
    status: `${plural(input.results, "result")} for ${quoted(input.query)}${skipped}`,
    headline: "",
    help: "",
    retry: false,
  };
}
