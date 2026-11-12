# V1 scope: managing subscriptions from the hub and from a note

**Written:** 2026-11-12, from Isaiah's ask of the same day. **Status:** proposed, awaiting
Isaiah's MVP call (decision D1 below). Nothing is built yet.

## The one sentence

**Add and remove channels from the hub's own channel list, and reach a video's channel
(and subscribe or unsubscribe) from its note, the same way Preview already can.**

## What exists today (checked on main bd069ef)

| Piece | Where | State |
|---|---|---|
| Channel list in the hub (desktop left column, phone ☰ sheet "Channels") | `renderChannels`, `src/hub.ts` | Filters the hub by channel. No add, no remove. |
| Add a channel | `ImportSubscriptionsModal` (Settings → Import…, command "Import YouTube subscriptions") | Takeout CSV, or paste one URL / `UC…` ID / @handle. Not reachable from the hub. |
| Subscribe | Channel screen button, search card `⋯` (#65, `src/subscribe.ts`) | One way only: "Subscribed" is a disabled state. |
| Remove a channel | `SubscriptionsStore.removeChannel` | **Exists and syncs (tombstone), but nothing in the UI calls it.** A user who imports 200 channels from Takeout cannot remove one. |
| Channel from a Preview | channel-name link in Preview's facts line → channel screen | Works. |
| Channel from a note | command "Open this video's channel" (`openVideoChannel`, `src/main.ts`) | Command palette only. Nothing on the note. |
| Search for channels | — | Not possible. Every search pins type = video (`TYPE_VIDEO`, `src/search-params.ts`) and the parser reads video renderers only. |

## In scope

### S1. Remove from the hub sidebar (easy removal)

- The channel list gets a header row: **Channels · [+] [Edit]**. On the phone it sits in the ☰
  sheet where "Channels" is today.
- **Edit** puts a red **−** at the end of every channel row (the unread count moves aside).
  One tap on **−** removes that channel at once. No confirm dialog.
- The row stays where it was and turns into **"Removed {name} · Undo"**, the same strip pattern
  search results use, so nothing below it jumps. Undo puts the channel and its videos back.
  The strips go when you tap **Done**.
- Removing does what `removeChannel` already does: the channel leaves the list and the feed
  poll, its New and Hidden videos leave the hub. **Saved videos, notes and watch history stay.**
  The tombstone stops the other device bringing it back; adding it again later works (fresh
  `addedAt` beats the tombstone, already handled in `mergeStates`).
- Desktop also gets **right-click → Unsubscribe** on a row, which is the same removal.

```
 Channels          [+]  [Edit]        Channels             [+]  [Done]
 All channels                         All channels
 Ali Abdaal               3           Ali Abdaal              (−)
 Veritasium               1           Removed Veritasium · Undo
 Kurzgesagt                           Kurzgesagt              (−)
```

### S2. Unsubscribe from the channel screen and search cards

- The channel screen's **Subscribed** button stops being a dead state: tap it and it becomes
  **Subscribe** again (the S1 removal), with a Notice "Unsubscribed from {name} · Undo".
- The search card `⋯` menu's greyed "Subscribed in YouTube for You" row becomes
  **Unsubscribe**.

### S3. Add from the hub sidebar, by searching channels

- **[+]** opens an **Add channels** sheet (modal on desktop):
  - One box: "Search channels, or paste a channel link". Enter runs one search; a pasted
    URL, `UC…` ID or @handle goes through the existing `addOne` path instead.
  - Results: avatar, name, @handle, subscriber count, and a **Subscribe** button per row.
    Tapping it subscribes at once and flips it to **Subscribed ✓**; tapping again undoes it.
    So "select several" = tap Subscribe on each; there is no separate confirm step. Done closes.
  - At the foot: **Import from Google Takeout…** (the existing import, moved here so all
    adding lives in one place; Settings keeps its button too).
- New code: a channel-type search (`params` type = channel), a `channelRenderer` parser, and a
  recorded fixture for it. It goes through the request governor and bot-check pause like video
  search: one request per Enter, never per keystroke.
- **Needs one live recording** of a channel search (one request from the Mac, like the #46
  recording run, not bulk probing) so the parser is tested against a real response.

### S4. The channel from a video note

- The note's player **⋯ pop-out** gets a channel row at the top:
  **{Channel name} ›** (opens the channel screen with that channel's videos, like Preview's
  link) and a **Subscribe / Subscribed** toggle beside it (same S2 behaviour).
- Why the pop-out and not the button bar: the bar is full on a phone, and the hub back button
  (separate thread) is the one getting a bar slot and a mockup. If Isaiah wants the channel in
  the bar instead, that thread's mockup should place both together.
- Channel ID: new notes get a `channel_id:` frontmatter line, so the row works with no network.
  Older notes use the hub's item when it has one; otherwise the first tap costs one player
  call (what the command does today). Nothing is fetched when the note opens or the pop-out
  opens: only on a tap.

## Out of scope (v2 tickets if wanted)

- Bulk select and remove many channels at once; sorting the channel list; channel avatars in
  the sidebar.
- Searching channels from the main "Search YouTube" screen (S3's search lives only in the Add
  sheet).
- Folders or groups of channels.
- Anything written to YouTube. Subscriptions stay the plugin's own list (#64).

## MVP triage (rule: bug in a shipped feature, needed for the store, or Isaiah names it)

| Item | Call | Why |
|---|---|---|
| S1 remove from sidebar | **MVP (recommended)** | Gap in shipped #65: users can subscribe and import but never remove. A store user's first Takeout import is likely to need pruning. |
| S2 unsubscribe on channel screen / search | **MVP (recommended)** | Same gap; reuses S1's removal, small. |
| S4 channel from a note | **MVP (recommended)** | Small: the code path exists (command), only a UI entry and a frontmatter line are new. |
| S3 add by channel search | **Post-MVP (recommended)** | New InnerTube request shape, needs a live recording and a new parser, adds request load. Adding already works from search cards, the channel screen and URL paste. Interim: [+] opens today's paste-a-link + Takeout dialog. |

**D1 (Isaiah):** accept this split, or make S3 MVP too.

## Done when (manual test, filled in with exact steps when built)

- Remove a channel in Edit mode, Undo it, remove it again; it stays gone after a sync to the
  other device; its Saved video and note are still there.
- Unsubscribe from a channel screen and from a search card `⋯`.
- From a hub-made note and from an old note: ⋯ → channel name opens its videos; Subscribe
  toggles.
- (If S3 is in) search a channel by name, subscribe to two from the results, see both in the
  sidebar.
