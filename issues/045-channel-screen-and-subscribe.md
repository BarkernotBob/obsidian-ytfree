# 045 — A channel screen: the back catalogue, a search inside it, and Subscribe

**Status:** **Built 2026-10-13** — awaiting manual test. Scope approved by Isaiah the same day
([docs/V1-SCOPE-CHANNEL-SCREEN.md](../docs/V1-SCOPE-CHANNEL-SCREEN.md)). Parser in `src/channel.ts`,
screen in `HubView` (`showChannel`), live check in `tests/channel.smoke.ts`. Raised by BarkernotBob:

> "I want a way to navigate to yt to subscribe to a channel, view other videos
> from that channel, etc. Was that not something you already worked on, because
> it's definitely not live in the feature."

**Created:** 2026-09-01

## Why this issue did not exist until now

It was decided on **2026-08-06** and written into HANDOFF.md under *"Decisions
taken this session, not yet issues"* — a channel screen with InnerTube browse
and continuation, a search box over it, and Subscribe opening the external
browser. It then sat in prose for four weeks. Nothing picked it up because
nothing reads prose; the backlog is `issues/`.

Worth saying plainly, because it is the second time this repo has lost work that
way: **a decision that is not an issue file is not a decision, it is a
paragraph.** The 2026-08-06 entry is a good specification and it bought nothing.

## Problem

The plugin can show you the last 15 videos of a channel you already subscribe
to, and nothing else. There is no answer inside Obsidian to "what else has this
person made?", which is the question that follows a good video. The only route
is youtube.com — the sidebar, the recommendations, the autoplay, everything this
plugin exists to sidestep.

Adjacent, and part of the same gap: there is no way to subscribe to a channel
you have just discovered. The 2026-08-06 session found the honest example — the
guest collaboration that never appeared in the hub because it was uploaded
to **a channel** not in `subscriptions.json`. The
answer at the time was "subscribe to RBN", and there was no way to do it from
here.

## What it should do

The full boundary is in the scope doc. In short:

**A channel screen**, a third surface beside the hub and search:

- Reached from a **video note**, a **hub card** and a **preview**. Wherever a
  channel name is already printed, it becomes the way in.
- Lists that channel's uploads, newest first, **paging with a continuation
  token** — InnerTube `browse` with the channel's `browseId`, not the 15-entry
  RSS feed. The RSS window is why this cannot reuse the poll.
- Has **a search box over that channel's catalogue**, distinct from the hub's
  "filter these videos" and from the YouTube-wide search.
- Carries **channel facts** at the top: name, avatar, subscriber count, video
  count.
- Uses **`buildCard` unchanged** for every row. Four actions, same layout, same
  no-reflow contract. What differs is the four `run` handlers, which is the
  seam that already exists between the hub and search.
- Uses **`searchScreen()`'s five states** for idle, loading, failed, empty and
  all-already-saved, so a third surface cannot invent a sixth wording for a
  moment the other two already describe.

**Subscribe**, on that screen and in a preview:

- Opens `youtube.com/channel/<id>` in the **external browser**. Desktop only.
- That is the whole of it, deliberately. Account sync already reads
  `/feed/channels`, so the next sync picks the channel up with no write path,
  no authenticated POST, and no new failure mode. Subscribing in-app is a v2 and
  the scope doc says why.
- **Depends on [044](044-subscription-sync-recovery-and-removals.md)**: with the
  sync wedged as it is today, subscribing on YouTube would appear to do nothing
  and this feature would read as broken. 044 goes first.

## Acceptance criteria

1. From a video note, a hub card and a preview, one action opens that video's
   channel screen.
2. The screen lists more than 15 videos for a channel that has more than 15, and
   pages further on demand.
3. The search box narrows to titles within that channel, and says so — the three
   search-shaped boxes in this plugin are visibly different things.
4. Save, Preview, Hide and Watch on a channel row do exactly what they do on a
   search result, including Save dropping the row out of a filtered list.
5. Nothing on the screen moves when a button is pressed (the `.ytfree-card-act`
   contract).
6. The screen has the same five states as search, worded by the same code.
7. Subscribe opens the channel in the external browser, and after a successful
   account sync the channel is in `subscriptions.json` and its new videos arrive
   in the Inbox.
8. On mobile the screen is usable at 390×844 — this is a phone-first surface,
   not a desktop screen that shrinks. Subscribe is absent on mobile rather than
   present and broken.
9. A channel that fails to load says so and offers Try again; it does not empty
   the screen silently.
10. Nothing here sends the account cookie file. The catalogue is read
    anonymously, as search is.

## Manual test (for BarkernotBob)

Install (`./install.sh`), reload Obsidian, then:

1. **From a preview.** Open the hub, tap any card. In the Preview sheet the channel name under
   the title is now a link. Tap it: the sheet closes and the hub shows that channel, with its
   avatar, name, handle, subscriber count and video count at the top.
2. **More than 15.** The channel lists about 28–30 videos, newest first. Scroll to the bottom
   and press **More videos**: another page appends below, and nothing above it moves.
3. **Search inside it.** Type a word in "Search <channel>" and press Enter. Only that channel's
   videos come back. Clear the box: the full list returns.
4. **Cards.** Save, Preview, Remove and Watch on a channel card behave exactly as on a search
   result. A video already in your hub shows its ticked state instead of disappearing.
5. **From a note.** Open any video note, run **YT Free: Open this video's channel** from the
   command palette. The hub opens on that channel. Works for a note the hub didn't make too
   (one extra lookup).
6. **Back.** The arrow returns to the screen you came from (the hub, or Search YouTube).
7. **Subscribe (desktop).** Press Subscribe: youtube.com opens on that channel in your browser.
   Subscribe there, then run **Sync account now**. The channel appears in the hub's channel
   list. On the phone there is no Subscribe button.
8. **Offline.** Turn Wi-Fi off and open a channel: it says it could not load and offers Try again.

Run `npm run smoke` on the Mac once: `tests/channel.smoke.ts` checks page two and the
in-channel search against live YouTube, which the cloud build machine cannot reach.

## Notes

- **This unblocks [048](048-rss-backfill.md).** A backfill needs exactly the
  call this issue builds — a channel's uploads beyond the RSS window. Building
  048 first would mean building this badly and twice.
- The 2026-08-06 note that "per-channel RSS lists only that channel's own
  uploads and never a guest's collaborations" is still true, and measured on
  2026-10-13 the same holds for a channel's Videos tab: Ward on Words' tab does
  not list the RBN collab. Collabs are caught from the signed-in subscription
  feed instead (GitHub #2).
- **The hub card reaches the channel through Preview** (card → Preview → channel
  name). The card body is already Preview, and a fifth button would break the
  four-button layout; the extra tap is the price of not doing that.
- Not run under `tools/search-screen-harness.mjs` yet: it needs Obsidian's
  `app.css` on the build machine. The screen reuses the search screen's
  classes and `renderResult`, so the no-reflow contract is the same code.
- `tools/search-screen-harness.mjs` renders the search screen under Obsidian's
  own `app.css` and reports any box that moved on a click. Point it at this
  screen too rather than arguing criterion 5 on paper.
