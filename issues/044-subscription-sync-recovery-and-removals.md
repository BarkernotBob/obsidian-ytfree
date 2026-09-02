# 044 — Subscriptions that never came back: a wedged session, a silent one, and unsubscribes that do nothing

**Status:** Scoped 2026-09-01. **Not built.** Raised by BarkernotBob:

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
