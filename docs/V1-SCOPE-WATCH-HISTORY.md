# V1 scope: watch history and stats (GitHub #48)

**Status:** answers from Isaiah 2026-11-09; awaiting his approval of this doc before building.
MVP item M6 in [V1-SCOPE-MVP](V1-SCOPE-MVP.md).

## What Isaiah decided (2026-11-09)

1. **Shape:** a **History** chip in the hub, newest first, tap to play, with one stats line on
   top: `142 videos · 38h 12m watched`. No charts, no per-day / per-week / per-channel breakdowns
   (post-MVP, see below).
2. **Never auto-cleared.** No age limit, no entry cap.
3. **Searchable** by title and channel name, offline (no YouTube request).
4. **"Watched"** = the In progress floor: you have played `min(2 min, 10% of the video)`.
5. **Two files** (Isaiah: "as long as it's durable and reliable"): resume positions stay in
   `progress.json`; the "watched" stamps move out of it into a new `history.json`. Nothing is
   stored twice.
6. **Watch time** = real time spent playing: paused time does not count, 10 min at 2× = 5 min.
7. **Existing history comes in:** every video in `progress.json`'s `watched` map is imported.
   Stats start at 0. No "since" label.
8. **Removal:** Remove in a History card's ⋯ menu (one video); **Clear history** in settings,
   with a confirm, wipes everything including stats.

## What main does today (read from the code)

- `progress.json` (plugin folder, synced through the vault) has `positions` (resume points,
  deleted at the credits) and `watched` (videoId → ISO time last played, moved at most once an
  hour, `markWatched` in `src/progress.ts`). Both are pruned at 365 days / 2000 entries
  (`pruneProgress`).
- `watched` is read only by Tidy watched notes (`src/tidy.ts`, via `progress.watchedFor`).
- No titles, channels or watch time are stored anywhere per play.
- In progress floor: `inProgressFloor` in `src/progress.ts`.

## v1 build

### Data: `history.json`

Next to `progress.json`. Per video:

```
{ videoId, title, channel, channelId?, duration?, firstWatchedAt, lastWatchedAt,
  watchSeconds: { [deviceId]: number }, removedAt? }
```

- **Device split for watch time:** each device only ever adds to its own counter. A merge takes
  the max per device and the stats add the devices together, so Mac + phone never double count
  and a stale copy can't roll a number back.
- **Merge:** per video, newest `lastWatchedAt` wins for title/channel, earliest `firstWatchedAt`
  is kept, `watchSeconds` merged as above. **Remove** writes a tombstone (`removedAt`) so a
  removal crosses to the other device instead of being merged back in. **Clear history** writes a
  `clearedAt` stamp; anything last watched before it is dropped on merge.
- **Durability:** same protocol as `SubscriptionsStore` / `ProgressStore`: every save reads and
  merges first; an unreadable file (iCloud placeholder, half-synced copy) means **no write**;
  writes are serialized. Written when a video crosses the floor, then at most once a minute while
  playing and on pause / close / teardown, never every progress tick.
- **No limit.** Roughly 150–200 bytes a video; 10,000 videos ≈ 2 MB.

### Recording

- A video enters History when its played position passes `inProgressFloor`. Title and channel
  come from what the player already has (no extra request).
- Watch time: wall-clock seconds while the video is actually playing (not paused, not
  buffering), counted in the player and flushed with the writes above. Works on desktop, phone,
  and the YouTube-player fallback (#43) once its time feed is wired.

### Migration (one time, on load)

- Every entry in `progress.json`'s `watched` map becomes a History entry with
  `lastWatchedAt` = the stamp, watch time 0. Title / channel from the hub item, else the video
  note's frontmatter, else **"Unknown video"**. No YouTube fetch (bot-check budget, #66).
- Then `watched` is removed from `progress.json`, and Tidy reads `lastWatchedAt` from History.
  The migration is idempotent and runs on whichever device loads first; the other device merges.
- Known side effects (told to Isaiah): imported videos count toward "videos" but add no watch
  time; old stamps did not check the floor, so a few short glances come in.

### UI

- Hub chip **History** after Hidden: `Inbox, In progress, Saved, Hidden, History, Everything`.
  Everything does **not** include History.
- Stats line at the top of the list: `N videos · Xh Ym watched` (totals across devices,
  tombstoned videos excluded).
- Search box on the History list filters by title and channel, case- and accent-insensitive,
  as you type.
- Cards reuse hub cards: picture from the video ID, title, channel, last watched date. Tap plays
  (resumes if a position exists). ⋯ → **Remove from history**.
- Settings → **Clear history…** → confirm ("Delete your whole watch history and stats on all
  devices? This can't be undone.").
- Same on phone and desktop.

### Tests

- Merge: device counters, tombstones, `clearedAt`, unreadable-file refusal, two devices
  migrating at once.
- Floor, pause/2× watch-time counting, migration title fallbacks, search matching.
- Tidy still finds watched notes after the move.

## Out of v1 (post-MVP, #73)

- Breakdowns: this week / per day / per channel, charts.
- Export history to a note or CSV.

## Manual test (after it is built)

Desktop, then phone:

1. Open the hub. A **History** chip sits between Hidden and Everything. Tap it: your older
   videos are listed (some may say "Unknown video"), newest first. The top line says
   `N videos · 0m watched`.
2. Play a 5-minute video for 20 seconds, close it. It is **not** in History.
3. Play it past 30 seconds at 1×, then 1 minute at 2×, pause 1 minute, close. It is at the top of
   History. Watch time went up by about 1.5 minutes, not 2.5 or 3.5.
4. Type part of its channel name in the History search box. Only that channel's videos show.
   Repeat with part of the title.
5. On the other device, wait for iCloud to sync, open History: the same video and the same total.
6. ⋯ → Remove from history. It disappears, and stays gone on the other device after sync.
7. Settings → Clear history… → confirm. History is empty and the stats read 0 on both devices.
