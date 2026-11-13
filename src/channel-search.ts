/**
 * Channel search for the Add channel sheet (GitHub #108,
 * docs/V1-SCOPE-MANAGE-SUBSCRIPTIONS.md S3), as pure functions.
 *
 * The request is a WEB search with the type pinned to channel
 * (`encodeChannelSearchParams`). WEB, not ANDROID: ANDROID answers a channel
 * search with `elementRenderer` blobs (measured 2026-11-13), which carry no
 * readable fields. WEB answers with one `channelRenderer` per channel, and that
 * is the only renderer read here. Like `search.ts`, nothing throws: an
 * unexpected tree is "no channels found", never an exception.
 *
 * Fixture: `tests/fixtures/channel-search-results-web.json`, one real response
 * recorded by `scripts/record-channel-search-fixture.mjs`.
 */

import { pickThumbnail } from "./search.ts";

/** One channel in the results. */
export interface ChannelResult {
  /** `UC…`. A row without one is dropped: there would be nothing to subscribe to. */
  channelId: string;
  title: string;
  /** "@smartereveryday", or "" when YouTube gave none. */
  handle: string;
  /** "11.9M subscribers", or "" for a channel that hides its count. */
  subscribers: string;
  /** Avatar URL, or "". */
  avatar: string;
}

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function at(root: unknown, ...path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    const object = record(node);
    if (!object) return undefined;
    node = object[key];
  }
  return node;
}

function text(value: unknown): string {
  const object = record(value);
  if (!object) return "";
  if (typeof object.simpleText === "string") return object.simpleText.trim();
  return array(object.runs)
    .map((run) => {
      const t = at(run, "text");
      return typeof t === "string" ? t : "";
    })
    .join("")
    .trim();
}

/**
 * The handle. YouTube's field names lie here: in the recorded response
 * `subscriberCountText` holds the @handle and `videoCountText` holds the
 * subscriber count. So the handle is read from whichever text starts with "@",
 * falling back to the channel's own URL (`/@name`, percent-encoded).
 */
function handleOf(channel: Record<string, unknown>): string {
  for (const field of ["subscriberCountText", "videoCountText"]) {
    const value = text(channel[field]);
    if (value.startsWith("@")) return value;
  }
  const base = at(channel, "navigationEndpoint", "browseEndpoint", "canonicalBaseUrl");
  if (typeof base === "string" && base.startsWith("/@")) {
    try {
      return decodeURIComponent(base.slice(1));
    } catch {
      return base.slice(1);
    }
  }
  return "";
}

/** "11.9M subscribers" from whichever of the two count fields says "subscriber". */
function subscribersOf(channel: Record<string, unknown>): string {
  for (const field of ["videoCountText", "subscriberCountText"]) {
    const value = text(channel[field]);
    if (/subscriber/i.test(value)) return value;
  }
  return "";
}

function parseChannel(raw: unknown): ChannelResult | null {
  const channel = record(raw);
  if (!channel) return null;
  const channelId = typeof channel.channelId === "string" ? channel.channelId : "";
  if (!CHANNEL_ID_RE.test(channelId)) return null;
  return {
    channelId,
    title: text(channel.title) || channelId,
    handle: handleOf(channel),
    subscribers: subscribersOf(channel),
    avatar: pickAvatar(at(channel, "thumbnail", "thumbnails")),
  };
}

/** The smallest avatar, which is already twice the size a row draws (88px). */
function pickAvatar(thumbnails: unknown): string {
  const smallest = array(thumbnails)
    .map((entry) => record(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry.url === "string"))
    .sort((a, b) => (Number(a.width) || 0) - (Number(b.width) || 0))[0];
  return smallest ? pickThumbnail([smallest]) : "";
}

/**
 * Every channel in a channel search response, in YouTube's order, each once.
 * WEB nests the list under `twoColumnSearchResultsRenderer.primaryContents`.
 */
export function parseChannelSearchResponse(raw: unknown): ChannelResult[] {
  const sections = array(
    at(raw, "contents", "twoColumnSearchResultsRenderer", "primaryContents", "sectionListRenderer", "contents"),
  );
  const results: ChannelResult[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const entry of array(at(section, "itemSectionRenderer", "contents"))) {
      const result = parseChannel(at(entry, "channelRenderer"));
      if (!result || seen.has(result.channelId)) continue;
      seen.add(result.channelId);
      results.push(result);
    }
  }
  return results;
}

/** What the sheet's one box does with what was typed. */
export type AddChannelInput =
  | { kind: "empty" }
  /** A channel link, `UC…` ID or @handle: added directly, no search. */
  | { kind: "link"; value: string }
  | { kind: "search"; query: string };

/**
 * A pasted URL, `UC…` ID or @handle goes to the existing add-one path; anything
 * else is a channel search. A bare @handle becomes its channel URL, which the
 * add-one path already knows how to read the ID off.
 */
export function classifyAddChannelInput(input: string): AddChannelInput {
  const value = input.trim();
  if (!value) return { kind: "empty" };
  if (/^@[^\s/?#]+$/.test(value)) return { kind: "link", value: `https://www.youtube.com/${value}` };
  if (/youtube\.com|youtu\.be/i.test(value) || /UC[A-Za-z0-9_-]{22}/.test(value)) {
    return { kind: "link", value };
  }
  return { kind: "search", query: value };
}

/** A result row's button. */
export interface ResultButton {
  text: string;
  title: string;
  /** A channel you followed before opening the sheet is a state, not an action here. */
  disabled: boolean;
  subscribed: boolean;
}

/**
 * Subscribe → Subscribed ✓, and tapping Subscribed ✓ undoes a subscribe made
 * in this sheet. A channel already on your list shows Subscribed ✓ and does
 * nothing; unsubscribing lives with the other unsubscribe controls.
 */
export function resultButton(subscribed: boolean, addedHere: boolean): ResultButton {
  if (!subscribed) {
    return {
      text: "Subscribe",
      title: "Add this channel to your YouTube for You subscriptions. Nothing is sent to YouTube.",
      disabled: false,
      subscribed: false,
    };
  }
  return addedHere
    ? { text: "Subscribed ✓", title: "Tap to undo.", disabled: false, subscribed: true }
    : {
        text: "Subscribed ✓",
        title: "This channel is already in your YouTube for You subscriptions.",
        disabled: true,
        subscribed: true,
      };
}

/** The status line after a search. */
export function searchStatus(query: string, count: number): string {
  if (count === 0) return `No channels found for “${query}”.`;
  return `${count} channel${count === 1 ? "" : "s"} for “${query}”. Tap Subscribe on each one you want.`;
}
