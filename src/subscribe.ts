/**
 * Subscribing inside YouTube for You (GitHub #65), the words and the choices, kept out
 * of `hub.ts` so they can be tested without Obsidian.
 *
 * A subscription is the hub's own channel list and nothing else: no sign-in, no
 * write to YouTube (GitHub #64). Adding a channel only puts it on the list the
 * feed poll walks, so its videos arrive on the next check.
 */

/** What the channel screen's (and a note's) Subscribe button says and does. */
export interface SubscribeButton {
  text: string;
  /** Hover text, and the button's accessible description. */
  title: string;
  /**
   * Always false now: tapping Subscribed unsubscribes, with an Undo
   * (docs/V1-SCOPE-MANAGE-SUBSCRIPTIONS.md, S2). Kept so callers stay simple.
   */
  disabled: boolean;
  /** Drawn as the filled call to action, or as the quieter "you follow this". */
  subscribed: boolean;
}

export function subscribeButton(subscribed: boolean): SubscribeButton {
  return subscribed
    ? {
        text: "Subscribed ✓",
        title: "You subscribe to this channel in YouTube for You. Tap to unsubscribe.",
        disabled: false,
        subscribed: true,
      }
    : {
        text: "Subscribe",
        title: "Add this channel to your YouTube for You subscriptions. Nothing is sent to YouTube.",
        disabled: false,
        subscribed: false,
      };
}

/** One row in a search card's `⋯` menu. */
export type SearchChannelMenuItem =
  | { key: "subscribe"; title: string; icon: string }
  | { key: "unsubscribe"; title: string; icon: string }
  | { key: "hide"; title: string; icon: string };

/**
 * A search card's `⋯` menu. Subscribe comes first; Hide this channel only for a
 * channel you do not follow, because a channel you subscribe to cannot be
 * hidden from search (issue 047). Once subscribed the row offers Unsubscribe,
 * so the menu still answers "do I follow this?" and is the way out too.
 */
export function searchChannelMenu(subscribed: boolean): SearchChannelMenuItem[] {
  if (subscribed) {
    return [{ key: "unsubscribe", title: "Unsubscribe in YouTube for You", icon: "user-minus" }];
  }
  return [
    { key: "subscribe", title: "Subscribe in YouTube for You", icon: "plus" },
    { key: "hide", title: "Hide this channel", icon: "eye-off" },
  ];
}

/** The Notice after subscribing. */
export function subscribedNotice(title: string): string {
  return `YouTube for You: subscribed to ${title || "this channel"}. Its videos arrive in the hub on the next check.`;
}

/** The Notice after unsubscribing anywhere but the Manage screen, which has its own Undo row. */
export function unsubscribedNotice(title: string): string {
  return `Unsubscribed from ${title || "this channel"}. New videos stop; Saved videos and notes stay.`;
}

/** The hub menu's heading over the channel list, with the Manage button beside it. */
export function subscriptionsHeading(count: number): string {
  return `Subscriptions · ${count}`;
}

/** The line at the top of Manage subscriptions: what Unsubscribe does and does not touch. */
export const MANAGE_EXPLAINER =
  "Unsubscribing stops new videos from that channel. Your Saved videos, notes and watch history stay.";

/** The small line under a channel's name on Manage subscriptions. */
export function manageRowMeta(newCount: number, lastUploadAge: string): string {
  const parts: string[] = [];
  if (newCount > 0) parts.push(`${newCount} new`);
  if (lastUploadAge) parts.push(`last upload ${lastUploadAge}`);
  return parts.join(" · ") || "No videos checked yet";
}

/** What an unsubscribed row says while it waits for Undo. */
export function unsubscribedRow(title: string): string {
  return `Unsubscribed from ${title || "this channel"}`;
}

/**
 * Manage subscriptions' filter: the channels whose name holds every word typed,
 * case and accents aside, in the hub menu's order (by name).
 */
export function filterChannels<T extends { title: string }>(channels: readonly T[], query: string): T[] {
  const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  const sorted = [...channels].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  if (words.length === 0) return sorted;
  return sorted.filter((c) => {
    const title = fold(c.title);
    return words.every((word) => title.includes(word));
  });
}

/** Where Google Takeout starts. */
export const TAKEOUT_URL = "https://takeout.google.com/";

/**
 * Getting `subscriptions.csv` out of Google Takeout, one step per line, in the
 * order the Takeout page asks for them. Exporting only the subscriptions keeps
 * the download to a few kilobytes instead of a whole YouTube archive.
 */
export const TAKEOUT_STEPS: readonly string[] = [
  "Open takeout.google.com, signed in to the Google account you use for YouTube.",
  "Click “Deselect all” at the top of the list.",
  "Scroll down to “YouTube and YouTube Music” and tick it.",
  "Click “All YouTube data included”, click “Deselect all” again, tick only “subscriptions”, then OK.",
  "Click “Next step”, then “Create export”. Google emails you a link, usually within minutes.",
  "Download and unzip it. The file is Takeout → YouTube and YouTube Music → subscriptions → subscriptions.csv.",
  "Pick that file below.",
];
