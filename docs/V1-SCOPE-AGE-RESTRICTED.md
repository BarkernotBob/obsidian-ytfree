# v1 scope: block age-restricted videos

Status: draft, MVP (Isaiah, 2026-11-13: "block and hide everywhere").

## Goal

An age-restricted video never plays in YouTube for You, and never shows in
search, a channel screen, the hub or a video note's lists. Mature content that
YouTube marks with a content warning is treated the same way.

## Today (main bd069ef)

- Own stream sends `contentCheckOk: true, racyCheckOk: true`
  (`src/innertube-context.ts`), which skips YouTube's content-warning screen.
- An age-gated video fails with `LOGIN_REQUIRED` and shows "needs a signed-in
  account" (`src/mobile/player-response.ts`), then can fall through to the
  YouTube player tier, which shows YouTube's own age gate.
- yt-dlp runs with no age limit.
- Search, channel browse and subscription feeds have no filter.

## v1

1. **Stop skipping warnings.** `playerBody` sends `contentCheckOk: false,
   racyCheckOk: false`. `CONTENT_CHECK_REQUIRED` and an age-gate
   `LOGIN_REQUIRED` both become a new failure kind `age-restricted`.
2. **yt-dlp:** pass `--age-limit 17` so yt-dlp refuses
   anything YouTube rates 18+. Its "confirm your age" error also maps to
   `age-restricted`.
3. **Blocked on Play.** `age-restricted` shows "Blocked: this video is
   age-restricted." No Open in YouTube link, no Try again, and it never falls
   through to the YouTube player tier. Downloads refuse it the same way.
4. **Restricted Mode for lists.** Every InnerTube search and channel browse
   request sends `context.user.enableSafetyMode: true` (YouTube's Restricted
   Mode). Zero extra requests.
5. **Remembered block list.** Any video found age-restricted (by 1-3 or 6) goes
   on a synced `ageRestricted` list. Listed videos are dropped from search,
   channel screens, hub Inbox/Saved/In progress and note suggestions, and a
   video note for one shows the Blocked message.
6. **Subscription feeds.** RSS carries no age flag. Each new feed item gets one
   player check before it reaches the Inbox, through the request governor's
   background budget (60/hour, `request-governor.ts`). Items wait as "checking"
   (not shown) until checked. Isaiah accepted the extra requests on the card.
7. **No setting.** Always on, not a toggle (a toggle is post-MVP if wanted).

## Out of v1

- Hiding already-created video notes in the vault (they show Blocked on Play).
- A user-facing toggle or per-channel allow list.
- Members-only videos (also `LOGIN_REQUIRED`): stay as today, "needs a
  signed-in account". Told apart by the reason text.

## Unknowns to verify (one search each, no bulk probing)

- U1: logged-out InnerTube honours `enableSafetyMode` for search and browse.
  Verified in the device test (step 1), not by probing.
- U2: the exact `reason` text for age gate vs members-only on the ANDROID/iOS
  clients. Taken from the device test's log line.

If U1 fails, search falls back to 6's check for each result shown, which costs
up to 20 requests per page: that needs Isaiah's OK first.

## Device test (Isaiah)

1. Search "age restricted" style terms for a video you know is 18+ on
   YouTube. Expected: it is not in the results.
2. Open that video's link from a note (paste its URL). Expected: "Blocked: this
   video is age-restricted", no Open in YouTube, no YouTube player.
3. Desktop with yt-dlp: same as 2.
4. Play a normal video. Expected: plays as before.
5. Hub after the next poll: no age-restricted video appears in Inbox.
