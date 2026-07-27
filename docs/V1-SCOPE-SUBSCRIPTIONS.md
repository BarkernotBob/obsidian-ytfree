# v1 scope — Subscriptions hub

Gate required before build. Written 2026-07-27.

**One sentence:** every YouTube channel you subscribe to lands in one hub inside Obsidian,
where new videos accumulate, unopened ones expire on their own, and clicking one turns it
into a Watch Later note with the player already pinned.

**Smallest version a stranger gets value from:** a list of channels is polled on a
schedule; new videos appear in a hub view; clicking a video creates its note and keeps it
forever; anything not clicked disappears after N days.

## Why this is not "install an RSS reader"

RSS Dashboard already does feeds, and it is staying for podcasts. It is the wrong tool for
the YouTube half for two specific reasons, both verified in its shipped `main.js`:

- **Its note template is static.** Placeholders are limited to
  `title, link, author, date, isoDate, summary, content, feedTitle, guid, image, source, tags`.
  There is no video ID, no description, no length, and no Templater execution. The note it
  produces cannot be a Watch Later note.
- **The trigger is Save, not open.** Nothing in the plugin connects "I opened this" to
  "make me a note." Retention exempts items where `saved || starred` — the mechanism is
  right, but the only way to set the flag is a deliberate second click.

Building it here also removes the most fragile code in the current setup. See the table
below: the channel feed carries the full description, so the watch-page scrape that
`8.Watch_Later_Template.md` performs — the one whose own error handling names
"YouTube served a consent or bot-check page" as an expected failure — is not needed on
this path at all.

## Verified foundations (tested 2026-07-27, before any code)

| Fact | Evidence |
|---|---|
| Channel feed needs no auth, no API key, no CORS proxy | plain `curl` of `youtube.com/feeds/videos.xml?channel_id=…` → 200 |
| Feed carries the **full description**, chapters intact | `<media:description>` on SmarterEveryDay `vS6HEes8daw` returned the complete text |
| Feed carries video ID, title, author, published, thumbnail | `<yt:videoId>`, `<title>`, `<author><name>`, `<published>`, `<media:thumbnail>` |
| Feed carries view count | `<media:statistics views="677465"/>` |
| Feed does **not** carry duration | zero `duration` tags in the document |
| Feed is a rolling window of exactly **15** entries | 15 `<entry>` on two unrelated channels; oldest on a slow channel dated 2024-09-30 |
| A dead channel ID fails loudly | bogus `channel_id` → HTTP 404, not an empty feed |
| Feeds mix Shorts with long-form, with no field to tell them apart | 4 of 6 recent MrBeast entries were Shorts |
| Shorts **are** cheaply detectable | `GET /shorts/<id>` returns 200 for a Short, 303 (redirect to `/watch`) for long-form |

Unverified, to confirm at build time: the exact column names in Google Takeout's
`subscriptions.csv`. Expected to be channel ID, channel URL, channel title.

## In scope for v1

### 1. Getting subscriptions in — one-time, not a sync
- Command: **Import YouTube subscriptions**. Takes Google Takeout's `subscriptions.csv`
  (Takeout → *YouTube and YouTube Music* → **subscriptions** only).
- Each row becomes a channel entry: channel ID, title, feed URL.
- Import is **additive and idempotent** — re-importing a newer export adds channels and
  never duplicates or resurrects removed ones. Unsubscribing on YouTube does not remove a
  channel here; that is a manual delete, deliberately.
- Also accepts a single channel URL or ID for adding one by hand.

### 2. The hub
A dedicated Obsidian view (`ItemView`), opened by command and by ribbon icon.

- One scrollable feed of videos across **all** channels, newest first.
- Per item: thumbnail, title, channel, relative age, and a state marker.
- Filters: **New** (default) · All · Kept. Plus filter-to-one-channel from a channel list
  in the sidebar of the view.
- Item states, and this is the whole design:
  - **New** — polled in, never clicked. Expires on schedule.
  - **Kept** — clicked. A note exists. Never expires, never auto-removed.
  - **Dismissed** — explicitly skipped by the user. Hidden, expires immediately.
- Clicking a video **creates its Watch Later note and opens it** (§4). One click, not two.
  There is no separate "save" affordance, because a click is the only signal we need.
- Per the global rule: clicking must not reflow the hub. Item cards are fixed-height;
  the state marker occupies reserved space whether or not it is filled.

### 3. Polling
- All channel feeds fetched via Obsidian's `requestUrl` on plugin load and every N
  minutes (default 60, configurable).
- Concurrency-capped (~5 at a time) so 100+ channels do not open 100 sockets.
- Dedupe by `yt:videoId`.
- **Descriptions are cached at poll time.** This matters: the feed window is only 15
  entries, so the description must be captured while the video is still in it, not when
  the note is finally created weeks later.
- A channel that 404s is marked broken in the hub with its error, and keeps being retried.
  It is not silently dropped.
- **Shorts are classified at poll time** with the `/shorts/<id>` status-code probe, and
  filtered out by default. One setting to include them.

### 4. Click → Watch Later note
Produces the same note shape `8.Watch_Later_Template.md` produces today, from cached feed
data instead of a scrape:

- Frontmatter: `title`, `url`, `author`, `published`, `created`, `tags`, `domain`,
  `media_link`.
- `## Notes` (empty, for flow capture) and `## Description` with the cached description.
- Timestamps in the description written as real `ytfree:<id>:<secs>` markdown links at
  creation time — matching the existing template's reasoning that a link in the file
  survives the plugin being off.
- Note named after the video title, sanitised, into `Watch Later/` (configurable).
- The pinned player mounts off `media_link` with no further work — that already exists.
- `length:` is written **empty**. Duration is not in the feed, and shelling out to yt-dlp
  on every click would put a multi-second stall in front of a click that should feel
  instant.
- If the note already exists, open it instead of overwriting it.

### 5. Expiry
- A **New** item older than N days (default 30) is removed from the hub on the next poll.
- **Kept** items are never removed by expiry, and neither are their notes. Deleting the
  note by hand does not resurrect the item.
- Expiry removes the hub entry only. It never touches a file in the vault. This is a
  hard rule: the plugin must not be capable of deleting a note.

### 6. Storage
- One JSON file for channels + video index + state, in the plugin folder.
- Bounded by design: channels × 15, minus expiry. At 200 channels that is a 3000-item
  ceiling before pruning — comfortably a single file, no sharding.

## Explicitly NOT v1 (→ v2 tickets)

- Podcasts, and any non-YouTube feed. RSS Dashboard keeps those.
- Fetching duration, transcript, or most-replayed at click time. Those commands already
  exist and stay manual.
- Search across the hub, tags, folders, custom sort.
- OPML import/export.
- Playlists, and "watch later"/"liked" list import from YouTube.
- Read-state merge across two Macs beyond whatever iCloud's last-writer-wins gives.
- Any mobile support — impossible here for the same reason as the parent project.
- Auto-creating notes for anything without a click. The click *is* the feature.

## Known hard limitations (accept, do not attempt to fix in v1)

- **The 15-entry window is the real constraint.** If Obsidian stays closed longer than a
  channel takes to publish 15 videos, those videos are missed permanently — there is no
  backfill in the feed. Poll-on-startup narrows it; nothing closes it. Document it rather
  than pretend.
- Takeout is a manual export. There is no supported way to read a subscription list
  programmatically, which is exactly why this is a one-time dump.
- Two Macs sharing one state file via iCloud will occasionally lose a read-state change to
  last-writer-wins.
- Shorts classification costs one HTTP request per new video. Cheap, but not free, and it
  is a heuristic that YouTube could change.

## Acceptance criteria

1. Importing a Takeout `subscriptions.csv` creates one channel per row, and re-importing
   the same file changes nothing.
2. The hub opens from the ribbon and lists videos from every imported channel, newest
   first, defaulting to New.
3. A poll picks up a video published since the last poll, with its description cached.
4. Clicking a video creates a note in `Watch Later/` whose pinned player loads and plays,
   whose `## Description` matches the video, and whose chapter timestamps seek the player.
5. Clicking that same video again opens the existing note rather than creating a second.
6. A clicked item shows as Kept and is still present after an expiry run that removes an
   unclicked item of the same age.
7. Deleting a Kept note by hand does not put the item back in New.
8. An expiry run deletes zero files from the vault.
9. A channel whose feed 404s shows an error in the hub and does not stop other channels
   from polling.
10. Shorts are absent from the hub by default and present when the setting is on.
11. Clicking any control in the hub moves nothing else on screen.

## What was built (2026-07-27)

All of the above, plus three things the scope did not anticipate:

- **The feed header's `<yt:channelId>` is wrong.** It carries the ID with the
  `UC` prefix stripped, while the same tag inside an entry carries it intact.
  Caught by the live smoke test, not by anything written from the spec. The
  parser reads the ID off the self link instead.
- **A nonexistent video ID also answers 200 to the Shorts probe**, so "200 means
  Short" only holds for IDs that came out of a feed. Anything other than 200 or
  303 is recorded as "unknown, ask again", never as long-form.
- **Expiry runs before the Shorts probe.** On a first import that is the
  difference between a few dozen HTTP requests and fifteen hundred.

Two deliberate departures from the letter of the scope:

- **Clicking a video does not remove its card.** Under the New filter, making an
  item Kept would drop it from the list and pull everything below it upward —
  exactly the reflow-on-click the global rule forbids. The card stays put and
  only its marker changes; the list re-filters on the next refresh or poll.
- **Poll-on-load is skipped if the last poll was under five minutes ago.**
  Restarting Obsidian three times in a row should not mean three full sweeps of
  every channel.

Storage is `.obsidian/plugins/ytfree/subscriptions.json`, separate from
`data.json` so a poll does not rewrite the settings file.

## Manual test (for BarkernotBob)

Relaunch Obsidian first — this is a new `main.js`.

**Getting channels in**
1. Command palette → **YT Free: Import YouTube subscriptions**. A dialog opens.
2. Click **Choose File** and pick your Takeout `subscriptions.csv`. Expect a line
   like "312 channels in the file — 312 new, 0 already here", then the hub opens
   and starts checking. Give it a minute on a first run.
   - No Takeout export handy? Type `https://www.youtube.com/@smartereveryday`
     into "Or add one channel" and press **Add** instead.
3. Run the import command again with the same file. Expect "… — 0 new, 312
   already here". Nothing should be duplicated.

**The hub**
4. Click the YouTube icon in the left ribbon. The hub opens as a full tab, with a
   channel list down the left and videos newest-first on the right.
5. Confirm the **New** filter is selected and that what you see is roughly the
   last 30 days across your channels — not every channel's entire history.
6. Click a channel in the left list. Only that channel's videos should remain.
   Click **All channels** to go back.
7. Look for a channel showing a red **!** instead of a count. Hover it — it
   should name the error. Everything else should still have polled.

**Clicking a video into a note**
8. Click any video card. A note should appear in `Watch Later/`, open, and its
   pinned player should load and play.
9. Scroll to `## Description`. If the video has chapters, click one — the pinned
   player should seek there.
10. Go back to the hub tab. **The card you clicked should still be exactly where
    it was**, now with a tick on the right. Nothing above or below it moved.
11. Click that same card again. It should open the note you already have, not
    create a second one.
12. Switch to **Kept**. Your clicked videos should be there and nothing else.

**Shorts**
13. Confirm no Shorts are in the list. Then Settings → YT Free → Subscriptions
    hub → turn **Include Shorts** on and click the refresh icon in the hub.
    Shorts should appear, labelled "Short" in the grey line under the title.

**Expiry, and the rule that matters most**
14. Click the **×** on a video you do not want. It should dim in place.
15. Settings → YT Free → **Forget unwatched videos after** → drag to 5 days.
    Back in the hub, click refresh. Videos older than 5 days that you never
    clicked should be gone from the list.
16. **Check that no note was deleted.** Open `Watch Later/` in the file explorer
    and confirm every note you made in step 8 is still there, including any whose
    video was just expired out of the hub.
17. Delete one of those notes by hand. Click refresh in the hub. The video must
    **not** reappear under New.

**Restart**
18. Quit and reopen Obsidian. The hub should remember your channels, what you
    kept, and what you dismissed.
