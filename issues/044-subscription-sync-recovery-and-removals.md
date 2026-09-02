# 044 — Subscriptions that never came back: a wedged session, a silent one, and unsubscribes that do nothing

**Status:** **Built 2026-09-02.** Scoped 2026-09-01. Raised by BarkernotBob:

> "adding or removing subs on youtube isn't publishing back to the app"

**Created:** 2026-09-01

## Problem

Three separate faults, found by reading the live state in the vault. Two are
bugs; the third is a design decision BarkernotBob has now overturned.

### 1. An expired session never recovers, even once it is valid again

The vault's `data.json` reads:

```json
"accountSession": {
  "status": "expired",
  "lastSyncAt": "2026-08-07T00:01:15.950Z",
  "lastError": "cookies are no longer valid: the cookie file is gone"
}
```

The cookie file is **not** gone. `~/Library/Application Support/obsidian-ytfree/cookies.txt`
exists and was last written 2026-08-17, ten days *after* the sync gave up — it
came back during the streaming work. But `syncAccount` returns at its second
line for any status other than `signed-in` ([main.ts:1620](../src/main.ts)),
and `syncIsDue` says `false` for the same reason
([account.ts:287](../src/account.ts)), so nothing has re-tried since. The
precondition that failed has been satisfied for two weeks and no code path
notices.

`"expired"` is doing two jobs and they are not the same job. *Your Google
session is dead, only a human at a sign-in window can fix it* is one thing.
*The cookie file was missing at 00:01 on the 7th* is another, and it is
cheap to re-test. Only the first should latch.

The consequence, measured: all 16 channels in `subscriptions.json` still carry
`addedAt: 2026-07-28` — the original Takeout import. Not one channel has been
added in the five weeks since. The RSS feed poll is healthy and current
(`lastPolledAt` is today), which is exactly why this went unnoticed: new
*videos* keep arriving from the channels you already had, so the hub looks
alive.

### 2. It failed silently for three and a half weeks

The Notice fires once, at the moment of expiry ([main.ts:1710](../src/main.ts)).
After that the only trace is one line in Settings you would have to go looking
for, and the hub — the screen you actually use — says nothing at all. A feature
that has been dead for a month should not require an audit to discover.

Note that the hub already has the vocabulary for this: it prints a "last polled"
line for the RSS poll ([hub.ts:1596](../src/hub.ts)). The account sync has no
equivalent.

### 3. Unsubscribing on YouTube does nothing here, on purpose

`mergeChannels` is additive-only and says so
([subscriptions.ts:576](../src/subscriptions.ts)):

> Re-importing a newer Takeout export adds what is new and changes nothing else
> — in particular it never removes a channel that has since been unsubscribed
> on YouTube. Unsubscribing there is not a statement about what you want to keep
> seeing here; removing a channel is a deliberate act in the hub.

That reasoning was about a **Takeout CSV** — a file you import by hand, possibly
months stale, where treating an absence as an instruction would be reckless. It
got inherited by the **account sync**, where the reasoning does not hold: that
list is read live from the subscription manager minutes ago, and an absence in
it *is* a statement. BarkernotBob has overturned it for this path.

## What it should do

### The session

- **Split the latch.** A missing or unreadable cookie file is a *retryable*
  failure, not an expiry — it must not set `status: "expired"`. Only a genuine
  signed-out response from YouTube (`looksLikeExpiry`'s "login details are
  needed" / "sign in to confirm" / "not a bot" family) latches and demands a
  human.
- **Re-probe on the way out of expiry.** Even a latched expiry should re-check
  once per sync period rather than never — cheap, bounded, and it is the
  difference between a month of silence and one wasted yt-dlp call every twelve
  hours. Keep `syncIsDue`'s floor: this must not become a retry loop, and the
  reason is unchanged (recurring authenticated requests get an account
  flagged).
- **Migrate the wedged state on load.** The session sitting in the vault right
  now should heal itself on the next launch rather than needing a manual
  sign-in — an expired session whose only recorded error is a missing file that
  now exists is not expired.

### The visibility

- **The hub says when the account last synced**, next to where it says when the
  feeds were last polled, and says so in the same voice.
- **A stale or expired sync is visible on the hub**, not only in Settings, with
  the action attached to it (sign in again). "Stale" is measurable: more than
  two sync periods since `lastSyncAt`.

### The removals

BarkernotBob's decision, in his words:

> "Channel leaves so no new videos come, but nothing gets purged from what's
> already in the hub."

- A channel present in `subscriptions.json` but **absent from a successful
  account sync** is dropped from the polled list. No new videos arrive from it.
- **Nothing already in the hub is touched** — not Kept, not undecided, not
  hidden. Videos of that channel stay exactly where they are and keep their
  notes, positions and decisions.
- Re-subscribing on YouTube brings the channel back on the next sync, and the
  existing `addedAt > removedAt` rule in `mergeStates` is the mechanism.

**The trap, and the reason this is not a two-line change.** `removedChannels`
already exists and looks like the right home. It is not. `mergeStates` applies
it to *items* as well as channels ([subscriptions.ts:376](../src/subscriptions.ts)):

```
// Removing a channel removes what you had not kept — but not a decision you
// made about one of its videos after removing it.
if (item.state === "kept") return true;
```

That is the correct behaviour for a **deliberate removal in the hub** and the
wrong behaviour for a **YouTube-side unsubscribe**, which BarkernotBob wants to purge
nothing. The two need separate lists with separate meanings — a new
`unsubscribedChannels` beside `removedChannels`, unioned by `mergeStates` the
same way and applied only to the channel list. Collapsing them would silently
change what the hub's own Remove button does.

**Only a sync that succeeded may remove anything.** An empty or partial channel
list from a failed fetch is not evidence of unsubscribing, and the existing
`.catch(() => [])` at [main.ts:1647](../src/main.ts) turns a network failure
into an empty list. Today that is harmless because nothing acts on absence;
after this change it would wipe every channel you have. The fallback to
`:ytsubs` compounds it — that endpoint only names channels that have posted
recently, so its absences mean nothing at all and it must **never** drive
removals.

## Acceptance criteria

1. A sync that fails because the cookie file is missing leaves the session
   `signed-in` with an error recorded, and the next scheduled sync tries again.
2. The session currently in the vault (`expired`, cookie file present) syncs on
   the next launch without a manual sign-in.
3. A sync that fails because YouTube says you are signed out still latches to
   `expired`, still stops the schedule, and still says so once.
4. An expired session re-probes at most once per sync period, never more often.
5. The hub shows when the account last synced, and shows it prominently when
   that is more than two periods ago or the session is expired.
6. A channel unsubscribed on YouTube stops producing new hub items after the
   next successful sync.
7. That channel's existing hub items — kept, undecided and hidden alike — are
   all still present, with their notes, positions and decisions intact.
8. Re-subscribing on YouTube restores the channel on the next sync, and its new
   videos arrive again.
9. A failed or empty channel fetch removes nothing. A sync that fell back to
   `:ytsubs` removes nothing.
10. The hub's own Remove-channel button behaves exactly as it does today,
    including purging undecided videos and sparing Kept ones.
11. Removals and unsubscribes both cross devices through `mergeStates`, and a
    device that has not synced yet does not resurrect them.

## Manual test (for BarkernotBob)

To be written when this is built, per the repo rule. It needs both a subscribe
and an unsubscribe on youtube.com, and the second half needs the iPhone to
prove the state crossed.

## Notes

- The immediate unblock, before any of this is built: sign in again from
  Settings. That alone restores adds. Removals need the code.
- The `data.json` read that found this is worth keeping as a habit — the plugin's
  live state answered in one command what the code could not.

## Built — 2026-09-02

All eleven criteria. The manual test is below; the second half needs the phone.

### The session

- **`COOKIE_FILE_MISSING`** replaces the old thrown string, and
  `looksLikeMissingCookieFile` is what tells the two kinds of failure apart.
  `looksLikeExpiry` consults it first and answers `false` — including for the
  legacy wording, which said "cookies are no longer valid" and is exactly what
  latched the live session. A missing file now records an error, leaves the
  status `signed-in`, and the next period looks again.
- **`lastAttemptAt` is a new field on `AccountSession`**, and it is what made
  the rest possible. `lastSyncAt` was doing two jobs: it was advanced on a
  failure so the schedule would wait a period, which meant settings reported a
  sync that never happened *and* an expired session — whose `lastSyncAt` was
  deliberately not advanced — had no stamp at all to pace a retry from. One
  field for what succeeded, one for what the schedule measures. Optional, so a
  session written before today still loads.
- **`syncIsDue` is true for an expired session**, at the same one-a-period rate
  and no faster. Only `signed-out` is never due. `syncAccount` no longer returns
  early on the status, and "Sync now" spends the probe if one is due.
- **`unwedgeSession`, run once at load** (`healAccountSession` in `main.ts`).
  Fixing the code that wrote the state does not fix the state, so this re-reads
  the disk and decides again. Moot for this vault as it turned out — BarkernotBob
  signed in again on the 1st, which is the unblock this issue's notes suggested
  — but the path is tested and it is what a future wedge heals through.
- **The expiry Notice fires on the transition only.** With re-probing, an
  outage would otherwise interrupt once every twelve hours forever.

### The visibility

- **`accountStatusLine`** — one pure function, three answers: nothing (signed
  out), a phrase for the status strip, or a phrase plus an alert. Stale is two
  periods, not one: a laptop that was shut when a period fell due is not a
  fault.
- The hub's status strip now carries `account synced 3 hours ago` beside
  `checked 20 minutes ago`, in the same voice.
- **A banner above the list** for the two states worth interrupting over, with
  its action attached — *Sign in again* for an expiry, *Sync now* for stale. It
  is always in the DOM and collapses by height and visibility, so a state change
  behind it cannot shove the list under a finger already on a card.
- `describeSession` says when a signed-in session's last sync failed. It looked
  identical to a healthy one, which is half of why a month went unnoticed.

### The removals

- **`unsubscribedChannels`**, a second tombstone list beside `removedChannels`,
  unioned by `mergeStates` the same way and **applied to the channel list
  only**. The item filter still reads `removedChannels` alone, so the hub's own
  Remove button purges undecided videos exactly as it did.
- **`applyUnsubscribes`** in `subscriptions.ts` does the reconciliation and
  touches no item. `SubscriptionsStore.applyAccountChannels` is the one call
  that adds and removes in a single save.
- **`complete` is a separate variable from "the list has channels in it"**, and
  that is the guard the issue asked for. Only a `/feed/channels` read that
  actually returned drives removals: the `.catch(() => [])` is now a `try` that
  logs and falls through, and a run that fell back to `:ytsubs` sets `complete`
  false and can only add. `applyUnsubscribes` refuses an empty list as a last
  line, but the real decision is at the call site where the failure is visible.
- **Re-subscribing needed a fix one level up.** `mergeStates` keeps the
  *earliest* `addedAt` when both devices know a channel — right for sorting a
  fresh import, wrong for arbitrating a tombstone, because the device that has
  not synced yet still holds the original stamp and would drag the merged value
  back under the tombstone's. It now tracks the newest stamp either device holds
  and answers tombstones with that. This was a live bug for `removedChannels`
  too: remove a channel on the Mac, add it back, and the phone's stale copy
  would delete it again on the next merge.

### Tests

`npm run check` clean: 562 unit tests, `tsc` clean, build clean — ten new, six
of them in `tests/merge.test.ts` as scenarios. The one changed assertion is the
old `syncIsDue({ status: "expired" }) === false`, which was the bug.

## Manual test

**The adds and the visibility (Mac, ten minutes).**

1. Settings → YT Free. The account line should read *Signed in… Synced N
   minutes ago* with no trailing failure.
2. Open the hub. The status strip under the search box ends with
   `account synced N minutes ago`. No banner.
3. Subscribe to a channel on youtube.com you do not already have.
4. Hub toolbar → the refresh button. The Notice counts the channels and says
   `(1 new)`. The channel appears in the channel list down the left.
5. Set **Sync every** to 1 hour in settings and edit `lastSyncAt` in
   `.obsidian/plugins/ytfree/data.json` to three hours ago, then reload
   Obsidian. The banner should appear above the list, red, reading
   *account last synced 3 hours ago* with a **Sync now** button. Press it: the
   banner goes, and nothing else on the screen moves. Put **Sync every** back.

**The removals (Mac, then the iPhone).**

6. Note a channel you are subscribed to that has videos in the hub. Keep one of
   them, hide another, and leave a third undecided. Open the kept one's note and
   type a word in it.
7. Unsubscribe from that channel on youtube.com.
8. Hub → refresh. The Notice should say `(0 new, 1 unsubscribed)`. The channel
   is gone from the channel list.
9. **The point of the whole issue:** all three videos are still in the hub —
   Everything shows the kept one and the undecided one, Hidden shows the third.
   The note still has your word in it. Nothing was purged.
10. Re-subscribe on youtube.com, refresh again. The channel is back in the list
    and its new videos arrive on the next poll.
11. On the iPhone, open the hub and wait twenty seconds for the refresh. The
    unsubscribed channel must not come back — and if you did step 10, it must
    be there rather than vanishing again a minute later.

**The wedge (only if you want to see it heal).** Stop Obsidian, set
`accountSession.status` to `"expired"` and `lastError` to
`"cookies are no longer valid: the cookie file is gone"` in `data.json`, and
start Obsidian. The console logs *account session un-wedged*, settings says
signed in, and no sign-in window was needed.
