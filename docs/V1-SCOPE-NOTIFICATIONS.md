# v1 scope — a notification when a new video lands in the Inbox

Gate required before build. Written 2026-08-03.

**One sentence:** when a poll drops new videos into the Inbox, the device that
polled POSTs one small JSON message to a URL you supply, so your phone can buzz.

**Smallest version a stranger gets value from:** paste a webhook URL into
settings, press *Send a test notification* to prove it, and from then on every
poll that finds new videos sends exactly one push naming how many and which
channels. Empty URL — the default — and the whole feature is inert.

## The constraint that decides the design

Obsidian mobile cannot raise an iOS notification. There is no plugin API for it,
no background execution to raise one from, and a plugin is not an app target so
it cannot hold a push certificate. `Notice` is an in-app toast that only exists
while Obsidian is on screen, which is precisely when you do not need telling.

So the only shape that works is: **the machine running the poll POSTs to a push
service, and the phone receives it.** The Mac is that machine most of the time —
it is the one left open — but nothing here assumes it: whichever device polls and
finds something new is the one that sends.

## The decision: a plain configurable webhook URL, not an integration

| | A — build in a provider (Pushover, APNs, ntfy client) | B — one URL setting, POST to it |
|---|---|---|
| Setup | account, app token, user key, per-provider settings | paste a URL |
| Providers supported | the one we chose | ntfy.sh, Pushover, Apple Shortcuts, Home Assistant, Slack, n8n, anything |
| Code | a provider adapter, and a second one the first time it is wrong | `requestUrl`, one POST |
| Secrets in the vault | an API token, in a file that syncs through iCloud | a URL, which is still a secret but only for one topic |
| Changing your mind later | a code change | edit a text field |

**B.** The transport is not the interesting part of this feature and picking one
would be guessing on BarkernotBob's behalf. A URL is decision-free to build, it is the
pattern he already uses elsewhere (`GAME_EVENT_WEBHOOK`), and every candidate
service on the shortlist accepts a plain HTTP POST.

The cost, recorded so it is not discovered later: **we cannot verify delivery.**
A 2xx from the webhook means the service accepted it, not that a phone lit up.
The *Send a test notification* button exists because of exactly that gap.

## The two rules this feature lives or dies by

**Batching.** A poll checks every channel and can add fifteen videos at once. It
sends **one** notification per poll, never one per video. A push that arrives
fifteen times is not a feature, it is a reason to turn the feature off.

**Dedupe.** The state file is one JSON blob synced by iCloud and both devices
poll it (see [issue 014](../issues/014-hidden-videos-came-back.md)), so "new to
this poll" is not the same as "new to you". Three layers, and all three are
needed:

1. `mergeItems` already only returns videos the stored index has never held, so
   anything already in the Inbox, already opened, already hidden, or restored
   from hidden is never a candidate — none of those paths goes through it.
2. A `notifiedVideos` tombstone list in the state file, merged and unioned by
   `mergeStates` exactly like `deletedVideos`. A video is notified about once,
   ever, on any device.
3. The claim happens **through a save**. `save()` re-reads the file and merges;
   what comes back tells us which of our candidates the other device had already
   claimed while we were polling. Those are dropped before anything is sent.

The residual race is one device's read-modify-write window, which is serialized
per device and measured in milliseconds. Two devices polling in the same
millisecond can double-send. That is the same class of limitation `mergeStates`
already documents and the only fix is a server.

**Never fatal.** A dead URL, no network, a 500, a timeout: logged to the console
and dropped. The poll finishes, the Inbox fills, nothing red appears. A
notification that fails is worth strictly less than the poll that produced it.

## What is in v1

- `notificationWebhook` — a URL. Empty by default, and empty means off.
- `notificationsEnabled` — a toggle, so the URL can be kept while the pushes are
  paused. Off by default.
- `notificationFormat` — `json` or `text`. JSON is the default and is what a
  webhook consumer wants; ntfy.sh renders a POST body verbatim as the message,
  so anyone using ntfy switches this to Text and gets a readable alert. Two
  values, one `if`, and it is the difference between the recommended setup
  looking finished and looking like a bug.
- One POST per poll that added anything, carrying the count, the channels, the
  titles, and the video IDs and URLs.
- A *Send a test notification* button.
- The first poll on a device that has never polled seeds the notified list
  silently. A fresh install importing 300 channels should not open with a push.

## Not in v1 (v2 tickets)

- **Per-channel rules.** "Notify me for these six channels only." Real, and it
  needs a channel-picker UI in a settings pane that is already long.
- **Quiet hours.** Needs a schedule, a timezone, and a decision about whether a
  suppressed notification is delayed or dropped.
- **A minimum-count threshold.** Cheap to build and a trap: the videos under the
  threshold are still marked notified, so they are silently swallowed forever.
  It only becomes safe alongside a digest, which is its own ticket.
- **Rich payloads.** Thumbnails, click-through URLs, per-service priority and
  tag headers. v1 sets `Title` and nothing else.
- **Notification history.** A list in settings of what was sent when.
- **Notifying for Watch Later and account-sync additions.** Those arrive because
  you put them there. A push telling you about your own click is noise.
- **Retry.** A failed send is dropped, not queued. The video stays marked
  notified, so a failure means one missed push, not a duplicate later.
- **Delivery verification.** Not possible through a generic webhook.

## Acceptance

1. Empty URL → no request is ever made, and no error anywhere.
2. A poll that adds 15 videos sends one POST, not 15.
3. A poll that adds nothing sends nothing.
4. The same video never produces a second notification — not on the next poll,
   not after being hidden and restored, not on the other device.
5. A webhook that 500s, times out, or does not resolve leaves the poll and the
   Inbox untouched, with one line in the console.
6. *Send a test notification* POSTs immediately and says what happened without
   moving anything else in the settings pane.
7. Nothing in the settings pane changes size when clicked.
