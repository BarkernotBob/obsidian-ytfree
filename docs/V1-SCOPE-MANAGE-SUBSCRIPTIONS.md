# V1 scope: managing subscriptions from the hub and from a note

**Written:** 2026-11-12, from Isaiah's ask of the same day. **Status:** D1 answered 2026-11-12: S1, S2, S4 MVP, S3 post-MVP.
S1 and S4 redesigned after Isaiah's review; awaiting his OK on the mockups. Nothing is built yet.

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

### S1. Unsubscribe from the hub (revised 2026-11-12)

Isaiah: a − in an edit mode reads as "remove from the sidebar", not as unsubscribe. Revised,
mockup: https://claude.ai/artifact/8brXvoZnBSibSMSAJpsHtF (boards 1 and 2).

- The hub menu's channel section is renamed **Subscriptions · 42** and gets a **Manage** button.
- **Manage** opens a **Manage subscriptions** screen inside the hub (Back returns): an
  **Add channel** button on top, a filter box, the line "Unsubscribing stops new videos from
  that channel. Your Saved videos, notes and watch history stay.", then one row per channel
  (name, new count, last upload) with a red-outlined **Unsubscribe** button.
- Tapping Unsubscribe acts at once, no dialog. The row stays in place as
  **"Unsubscribed from {name} · Undo"**. Undo puts the channel and its videos back.
- Shortcut: long-press a channel in the menu (right-click on desktop) → **Unsubscribe from {name}**.
- What it does is `removeChannel`: off the list and the feed poll, New and Hidden videos leave
  the hub; Saved videos, notes and history stay; tombstone syncs; adding back later works.

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

### S4. The channel from a video note (revised 2026-11-12)

Isaiah: not too hidden. Revised, mockup board 3: an always-visible **channel row directly under
the player's button bar**: avatar initial, channel name, "See all their videos ›" (opens the
channel screen, like Preview's link), and a **Subscribe / Subscribed ✓** button on the right.
Tapping Subscribed unsubscribes at once with an Undo, same as S1.

- Channel ID: new notes get a `channel_id:` frontmatter line, so the row works with no network.
  Older notes use the hub's item when it has one; otherwise the row still shows the name from
  `author`, and the first tap costs one player call (what the command does today). Nothing is
  fetched when the note opens.
- The hub back button (another thread) lives in the button bar; this row does not touch the bar.

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

**D1 answered (Isaiah, 2026-11-12):** S1, S2, S4 MVP; S3 (channel search) post-MVP.

## Done when (manual test, filled in with exact steps when built)

- Remove a channel in Edit mode, Undo it, remove it again; it stays gone after a sync to the
  other device; its Saved video and note are still there.
- Unsubscribe from a channel screen and from a search card `⋯`.
- From a hub-made note and from an old note: ⋯ → channel name opens its videos; Subscribe
  toggles.
- (If S3 is in) search a channel by name, subscribe to two from the results, see both in the
  sidebar.
