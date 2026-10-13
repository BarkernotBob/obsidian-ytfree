# 048 — The 15-entry window loses videos permanently

**Status:** **Built 2026-10-13** — awaiting manual test. Rules in `src/backfill.ts` (tested in
`tests/backfill.test.ts`), fetching in `HubView.backfillChannel`, publish dates from
`fetchPublishDate`. Two live shapes (Videos-tab page 2, the player's `publishDate`) are checked by
`npm run smoke` (`tests/channel.smoke.ts`), not yet run against YouTube.

**Created:** 2026-09-01

## Problem

A YouTube channel feed is **a rolling window of exactly 15 entries with no
backfill**. The whole hub design is bent around that fact — it is the first
thing `subscriptions.ts` says about itself
([subscriptions.ts:8](../src/subscriptions.ts)), and it is why descriptions are
cached at poll time rather than fetched later.

The consequence was written down and left:

> The 15-entry window has no backfill. If Obsidian stays closed longer than a
> channel takes to publish 15 videos, those videos are missed permanently.
> Polling on startup narrows it; nothing closes it.

Nothing closes it. A channel that posts daily rolls its window in a fortnight;
a channel that posts several times a day rolls it in days. Miss that window —
a holiday, a broken plugin, a laptop that stayed shut, or **the account sync
being wedged for five weeks as it was in
[044](044-subscription-sync-recovery-and-removals.md)** — and those videos never
enter the hub. They are not marked missed. Nothing reports a gap. The Inbox
simply never contained them, and there is no way to find out what you did not
see.

This is the only failure in the plugin that loses data silently and
irreversibly, which is why it is worth building despite being rare.

## Why it depends on 045

Closing the gap needs a way to list a channel's uploads **beyond the last 15** —
InnerTube `browse` with a continuation token. That is exactly the call
[045](045-channel-screen-and-subscribe.md) builds for the channel screen.
Building this first would mean writing that call badly, in the poll path, and
then writing it again properly for the screen.

## What it should do

**Detect the gap rather than guess at it.** A poll can tell it may have missed
something: if *every* entry in a channel's 15-entry feed is newer than the
newest item that channel has in the hub, the window rolled completely and there
is an unknown number of videos in between. If any entry overlaps, nothing was
missed. That check is cheap, exact in the negative case, and needs no new state.

**Backfill only on that signal, and only back to the retention horizon.** The
hub keeps roughly 30 days ([subscriptions.ts:855](../src/subscriptions.ts)), and
expiry measures age from the publish date precisely so a fresh import trims
itself rather than dumping every channel's whole window. A backfill must obey
the same horizon — it is filling a hole in the last 30 days, not importing a
back catalogue. Fetching further would flood the Inbox with videos that expiry
would delete on the next poll.

**Never on every poll, and never for every channel.** The poll runs hourly
across 16 channels; adding an InnerTube browse to each would be a different
traffic profile against YouTube for a case that fires a few times a year. Only
the channel that shows the signal, only once per gap.

**Say what it did.** A backfill that silently inserts eleven videos into the
Inbox reads as a bug. One notice: which channel, how many, what date range.

**Respect every existing tombstone.** Backfilled videos go through the same
path as feed videos — `deletedVideos`, hidden state, expiry and the merge rules
all apply unchanged. A video you deleted in July must not return in September
because a backfill found it again.

## Acceptance criteria

1. A channel whose feed window rolled completely between two polls is detected
   as a gap.
2. A channel whose feed overlaps what the hub already has triggers no backfill.
3. A detected gap fetches that channel's uploads until it reaches a video the
   hub already has or the 30-day horizon, whichever comes first.
4. Backfilled videos arrive in the Inbox with correct titles, publish dates,
   thumbnails and durations, indistinguishable from feed-delivered ones.
5. Nothing older than the retention horizon is imported.
6. A deleted, hidden or expired video is not resurrected by a backfill.
7. A backfill happens at most once per detected gap, and never on an ordinary
   poll.
8. The user is told, once, what was backfilled.
9. A backfill failure leaves the poll's normal results intact and does not
   retry in a loop.
10. Nothing in this path sends the account cookie file.

## Manual test (for BarkernotBob)

Needs a channel that posts often (at least 15 videos in the last 30 days).

1. Quit Obsidian. Open `subscriptions.json` in the plugin folder and, for that channel, delete
   every item whose video is in its current feed (the newest 15), keeping at least one older item.
   Keep a copy of the file first.
2. Reopen Obsidian and run **Refresh subscriptions**.
3. Expect one Notice: "<Channel>: N videos from <date> to <date> were missed by the feed and added
   to your Inbox."
4. The Inbox has the 15 feed videos plus the older ones in between, each with a real publish date,
   thumbnail and duration, and nothing older than 30 days (or your expiry setting if it is on).
5. Run **Refresh subscriptions** again. No second Notice: the gap is closed.
6. Delete one backfilled video, repeat steps 1–2. It does not come back.

What the plugin does on a gap:

- Detects it before merging the feed: a full 15-entry feed, a channel the hub already has items
  for, no entry the hub knows (as an item or a deleted video), oldest entry inside the horizon.
  A failed fetch is no feed at all, so it can never look like a gap.
- Horizon: the expiry setting when on, else 30 days.
- Reads the channel's Videos tab (no cookies), up to 5 pages, newest first, stopping at the first
  known video or the first one past the horizon. Each found video gets a player call for its exact
  publish date; a guessed date from "3 weeks ago" is never stored.
- A failure logs and leaves the poll's results as they were. The next poll sees the feed it just
  merged, so it does not retry.

## Notes

- The related 2026-08-06 finding is **not** this bug and is not fixed by it: a
  collaboration uploaded to someone else's channel never appears in your
  subscribed channel's feed, because per-channel RSS lists only that channel's
  own uploads. That is GitHub issue #2, answered from the account's subscription feed.
- Feed fetches are already retried four times with backoff, and a channel is
  only painted as failed after `FEED_FAILURE_GRACE` consecutive failed polls,
  because this endpoint 404s at random. A gap detector must not treat a failed
  fetch as an empty window — that is the obvious way to make this feature
  backfill constantly against a flaky endpoint.
