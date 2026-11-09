/**
 * Subscribing inside YT Free (GitHub #65), the words and the choices, kept out
 * of `hub.ts` so they can be tested without Obsidian.
 *
 * A subscription is the hub's own channel list and nothing else: no sign-in, no
 * write to YouTube (GitHub #64). Adding a channel only puts it on the list the
 * feed poll walks, so its videos arrive on the next check.
 */

/** What the channel screen's Subscribe button says and does. */
export interface SubscribeButton {
  text: string;
  /** Hover text, and the button's accessible description. */
  title: string;
  /** Subscribed is a state, not an action: there is no unsubscribe here. */
  disabled: boolean;
}

export function subscribeButton(subscribed: boolean): SubscribeButton {
  return subscribed
    ? {
        text: "Subscribed",
        title: "This channel is in your YT Free subscriptions.",
        disabled: true,
      }
    : {
        text: "Subscribe",
        title: "Add this channel to your YT Free subscriptions. Nothing is sent to YouTube.",
        disabled: false,
      };
}

/** One row in a search card's `⋯` menu. */
export type SearchChannelMenuItem =
  | { key: "subscribe"; title: string; icon: string }
  | { key: "subscribed"; title: string; icon: string }
  | { key: "hide"; title: string; icon: string };

/**
 * A search card's `⋯` menu. Subscribe comes first; Hide this channel only for a
 * channel you do not follow, because a channel you subscribe to cannot be
 * hidden from search (issue 047). Once subscribed the row stays, greyed, so the
 * menu still answers "do I follow this?".
 */
export function searchChannelMenu(subscribed: boolean): SearchChannelMenuItem[] {
  if (subscribed) {
    return [{ key: "subscribed", title: "Subscribed in YT Free", icon: "check" }];
  }
  return [
    { key: "subscribe", title: "Subscribe in YT Free", icon: "plus" },
    { key: "hide", title: "Hide this channel", icon: "eye-off" },
  ];
}

/** The Notice after subscribing. */
export function subscribedNotice(title: string): string {
  return `YT Free: subscribed to ${title || "this channel"}. Its videos arrive in the hub on the next check.`;
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
