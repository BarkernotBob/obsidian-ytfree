/**
 * The push that tells you a new video landed in the Inbox.
 *
 * Obsidian mobile cannot raise an iOS notification — there is no API for it, no
 * background execution to raise one from, and a plugin is not an app target. So
 * the device that *polls* is the device that notifies: it POSTs to a URL you
 * supply, and whatever is on the other end of that URL is what buzzes your
 * phone. See `docs/V1-SCOPE-NOTIFICATIONS.md`.
 *
 * Everything in this file is pure except `sendNotification`, which takes its
 * transport as an argument. The two rules the feature lives or dies by —
 * one push per poll, and never twice for the same video — are `pickNotifiable`
 * and `rememberNotified`, and they are tested without a network.
 */

import type { HubItem } from "./subscriptions.ts";

/** JSON body, or the human sentence on its own. See `NotificationFormat`. */
export type NotificationFormat = "json" | "text";

export interface NotificationSettings {
  /** Where to POST. Empty is the default and means the feature is off. */
  webhook: string;
  /** Off pauses the pushes without making you delete the URL. */
  enabled: boolean;
  format: NotificationFormat;
}

/**
 * How many notified video IDs are remembered, oldest off the end.
 *
 * The same reasoning as `HIDDEN_LIMIT` and `DELETED_LIMIT`: this is a list, not
 * an archive. A record that falls off the end means a video could in principle
 * be announced twice — but only if it is still inside its channel's 15-entry
 * feed window *and* has left the hub index, which is a combination that does
 * not happen in practice.
 */
export const NOTIFIED_LIMIT = 500;

/** How many titles one push spells out before it starts counting instead. */
export const NOTIFICATION_TITLE_LIMIT = 3;

/** A video, as a notification names it. */
export interface NotifiedVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  url: string;
}

/** The body of one push. Sent as JSON, or as `message` alone. */
export interface NotificationPayload {
  /** Always `"ytfree.inbox"`, so a shared webhook can tell senders apart. */
  event: "ytfree.inbox";
  title: string;
  message: string;
  count: number;
  channels: string[];
  videos: NotifiedVideo[];
  sentAt: string;
}

/**
 * Which of a poll's new videos are worth a push, and have not had one.
 *
 * `added` is what `mergeItems` handed back, which is already only videos the
 * stored index has never held — a video that was hidden, kept, restored or
 * merely sitting in the Inbox never reaches here, because none of those paths
 * goes through `mergeItems`.
 *
 * What is left to check is what happened *during* the poll: an item can be
 * hidden or opened on the other device between the feed fetch and the save, and
 * a poll that expires an item it just added should not announce it either. So
 * candidates are re-resolved against the live index by ID rather than trusted
 * as the objects the merge produced — the same discipline `SubscriptionsStore.live`
 * applies for the same reason.
 *
 * Watched videos are excluded unless the Inbox is showing them, because the
 * Inbox is what this announces and `visibleItems` drops them from it.
 */
export function pickNotifiable(
  added: readonly HubItem[],
  live: readonly HubItem[],
  notified: ReadonlyArray<{ id: string; at: string }>,
  options: { showWatched?: boolean; includeShorts?: boolean } = {},
): HubItem[] {
  const already = new Set(notified.map((entry) => entry.id));
  const byId = new Map(live.map((item) => [item.videoId, item]));
  const seen = new Set<string>();
  const picked: HubItem[] = [];

  for (const candidate of added) {
    if (already.has(candidate.videoId) || seen.has(candidate.videoId)) continue;
    const item = byId.get(candidate.videoId);
    // Gone: expired by this same poll, or deleted on the other device while the
    // feeds were in flight. Either way there is nothing in the Inbox to point at.
    if (!item) continue;
    if (item.state !== "new") continue;
    if (item.watched && !options.showWatched) continue;
    // `isShort` is null until the probe runs, and null is "not known to be a
    // Short" — announcing it is right, and the card shows up in the Inbox too.
    if (item.isShort === true && !options.includeShorts) continue;
    seen.add(item.videoId);
    picked.push(item);
  }

  return picked;
}

/**
 * Write the claim down, capped, without losing an existing stamp.
 *
 * Stamped rather than a bare list of IDs so `mergeNotified` has something to
 * order the cap by. Re-claiming a video keeps the *first* stamp: the question
 * the list answers is "has this been announced", and the answer does not get
 * newer.
 */
export function rememberNotified(
  notified: ReadonlyArray<{ id: string; at: string }>,
  ids: readonly string[],
  now: Date,
  limit = NOTIFIED_LIMIT,
): Array<{ id: string; at: string }> {
  const at = now.toISOString();
  const byId = new Map(notified.map((entry) => [entry.id, entry]));
  for (const id of ids) {
    if (!byId.has(id)) byId.set(id, { id, at });
  }
  return [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-limit);
}

/**
 * Two devices' claim lists, unioned — the earlier stamp wins.
 *
 * Called by `mergeStates`, and the reason a video announced by the Mac is not
 * announced again by the phone: the phone merges this list in before it decides
 * what to send. The earlier stamp is the true one because it is the moment the
 * push actually went out.
 */
export function mergeNotified(
  mine: ReadonlyArray<{ id: string; at: string }>,
  theirs: ReadonlyArray<{ id: string; at: string }>,
  limit = NOTIFIED_LIMIT,
): Array<{ id: string; at: string }> {
  const byId = new Map<string, string>();
  for (const list of [theirs, mine]) {
    for (const entry of list) {
      const seen = byId.get(entry.id);
      if (!seen || entry.at < seen) byId.set(entry.id, entry.at);
    }
  }
  return [...byId]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(-limit);
}

/**
 * Of the videos this device claimed, the ones the other device had not.
 *
 * `diskNotified` is the claim list as it stood on disk *before* this device's
 * save merged into it — which `SubscriptionsStore.save` hands back for exactly
 * this purpose. Both devices poll the same feeds off the same iCloud file, so
 * without this the Mac and the phone would each send their own push for the
 * same video within a minute of each other.
 *
 * The remaining race is the window between one device's read and its write.
 * It is serialized per device and measured in milliseconds, and closing it
 * properly needs a server rather than a shared file.
 */
export function unclaimed(
  candidates: readonly HubItem[],
  diskNotified: ReadonlyArray<{ id: string; at: string }>,
): HubItem[] {
  const claimed = new Set(diskNotified.map((entry) => entry.id));
  return candidates.filter((item) => !claimed.has(item.videoId));
}

/** "1 new video", "6 new videos" — the notification's own headline. */
export function notificationTitle(count: number): string {
  return `YT Free: ${count} new video${count === 1 ? "" : "s"}`;
}

/**
 * The sentence a phone shows on the lock screen.
 *
 * One video gets its title and its channel, because that is the whole message.
 * A handful get their titles listed. A poll that lands a dozen gets a count and
 * the channels, because twelve titles is not a notification, it is a document.
 */
export function notificationMessage(videos: readonly NotifiedVideo[]): string {
  if (videos.length === 0) return "";
  if (videos.length === 1) return `${videos[0].title} — ${videos[0].channelTitle}`;
  const channels = uniqueChannels(videos);
  if (videos.length <= NOTIFICATION_TITLE_LIMIT) {
    return videos.map((video) => `${video.title} (${video.channelTitle})`).join("\n");
  }
  const named = channels.slice(0, NOTIFICATION_TITLE_LIMIT).join(", ");
  const rest = channels.length - NOTIFICATION_TITLE_LIMIT;
  return `${videos.length} new videos from ${named}${rest > 0 ? ` and ${rest} more` : ""}.`;
}

function uniqueChannels(videos: readonly NotifiedVideo[]): string[] {
  const seen = new Set<string>();
  const channels: string[] = [];
  for (const video of videos) {
    if (seen.has(video.channelTitle)) continue;
    seen.add(video.channelTitle);
    channels.push(video.channelTitle);
  }
  return channels;
}

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** One poll's worth of new videos, as the thing that goes over the wire. */
export function buildPayload(items: readonly HubItem[], now: Date): NotificationPayload {
  const videos: NotifiedVideo[] = items.map((item) => ({
    videoId: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    url: videoUrl(item.videoId),
  }));
  return {
    event: "ytfree.inbox",
    title: notificationTitle(videos.length),
    message: notificationMessage(videos),
    count: videos.length,
    channels: uniqueChannels(videos),
    videos,
    sentAt: now.toISOString(),
  };
}

/** The payload a test button sends — real shape, obviously fake contents. */
export function testPayload(now: Date): NotificationPayload {
  return {
    event: "ytfree.inbox",
    title: "YT Free: test notification",
    message: "If you are reading this on your phone, the webhook works.",
    count: 0,
    channels: [],
    videos: [],
    sentAt: now.toISOString(),
  };
}

/**
 * What a POST looks like, whichever format is chosen.
 *
 * JSON is the default and is what a webhook consumer, a Shortcut or an
 * automation platform wants. Text exists for ntfy.sh, which renders the request
 * body verbatim as the notification: pointed at a topic URL, a JSON body shows
 * up on the lock screen as JSON.
 *
 * `Title` is set in both cases. ntfy reads it; everything else ignores an extra
 * header, so it costs nothing to send.
 */
export function buildRequest(
  payload: NotificationPayload,
  format: NotificationFormat,
): { body: string; contentType: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { Title: payload.title };
  if (format === "text") {
    return { body: payload.message || payload.title, contentType: "text/plain", headers };
  }
  return { body: JSON.stringify(payload), contentType: "application/json", headers };
}

/**
 * Is this a URL we are willing to POST to?
 *
 * `http` and `https` only. A `file:` or `obsidian:` URL in this field is a typo
 * at best, and refusing it here means the poll never hands one to `requestUrl`.
 */
export function isValidWebhook(url: string): boolean {
  const text = url.trim();
  if (!text) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Is the feature switched on and pointed somewhere real? */
export function notificationsReady(settings: NotificationSettings): boolean {
  return settings.enabled && isValidWebhook(settings.webhook);
}

/**
 * The reserved line under the webhook field, in words.
 *
 * Deliberately says the *consequence* rather than the state: "no messages will
 * be sent" is the fact a reader needs, and it is the one an empty field and a
 * switched-off toggle share.
 */
export function describeWebhook(settings: NotificationSettings): string {
  if (!settings.webhook.trim()) return "No URL set — no messages will be sent.";
  if (!isValidWebhook(settings.webhook)) return "That does not look like an http or https URL.";
  if (!settings.enabled) return "Paused — the URL is kept, no messages will be sent.";
  return "Ready. New videos found by a check will be sent here.";
}

/** What the test button just did. Blunt about failure; there is no retry. */
export function describeTestOutcome(outcome: SendOutcome): string {
  if (outcome.ok) return "Sent. If nothing arrives, the URL is wrong or the service dropped it.";
  if (outcome.reason === "disabled") {
    return "Not sent — set a valid https URL and turn Send notifications on first.";
  }
  if (outcome.reason === "empty") return "Not sent — nothing to say.";
  return `Failed: ${outcome.error ?? "the request did not go through"}.`;
}

export interface PostRequest {
  url: string;
  body: string;
  contentType: string;
  headers: Record<string, string>;
}

/** The one impure thing, injected so the rules above can be tested offline. */
export type Post = (request: PostRequest) => Promise<void>;

export type SendOutcome =
  | { ok: true }
  | { ok: false; reason: "disabled" | "empty" | "failed"; error?: string };

/**
 * Send one notification, and never let it matter that it failed.
 *
 * Every path out of here is a resolved promise. A dead host, a 500, a webhook
 * that has been revoked — the caller is a poll that has just filled the Inbox
 * correctly, and the worst outcome available is that a push did not arrive.
 * Anything that turns that into a broken poll or a red banner is a bug.
 */
export async function sendNotification(
  settings: NotificationSettings,
  payload: NotificationPayload,
  post: Post,
): Promise<SendOutcome> {
  if (!notificationsReady(settings)) return { ok: false, reason: "disabled" };
  if (payload.count === 0 && payload.videos.length === 0 && !payload.message) {
    return { ok: false, reason: "empty" };
  }
  const request = buildRequest(payload, settings.format);
  try {
    await post({ url: settings.webhook.trim(), ...request });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("YT Free: notification webhook failed.", err);
    return { ok: false, reason: "failed", error };
  }
}
