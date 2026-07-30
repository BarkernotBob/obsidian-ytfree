# 018 — What Watch Later is for now

Status: **Scoped — needs a decision from BarkernotBob. Nothing built.**

> "Look at how to handle watch later moving forward"

The name now means three different things in this plugin, and after 017 they
have started to disagree with each other. This is what each one is, where they
collide, and what I would do — with the one question I cannot answer for you at
the end.

---

## The three Watch Laters

**1. YouTube's playlist.** Pulled in by the account sync (`:ytwatchlater`,
through yt-dlp with your cookies, desktop only, every 12 hours). Read-only —
nothing in this plugin has ever written to YouTube, and that is deliberate.

**2. Hub items with `origin: "watchlater"`.** What the import produces. They
arrive with **no description and no publish date**, because a flat playlist
listing carries neither and fetching them per video would be one round trip
each. The missing date is load-bearing: expiry ignores anything it cannot date,
so a Watch Later item **never falls out of the hub on its own**.

**3. The vault folder called `Watch Later`.** Where a hub click puts a new note.
The setting is called *New-note folder*; the default value is `Watch Later`, and
`buildWatchLaterNote` is the function that fills it. It has nothing to do with
YouTube's playlist beyond the name.

## What 017 changed underneath them

- **Opening a note now Keeps its item.** So the Inbox drains as you watch, which
  is what it was supposed to do all along.
- **A watched note with nothing written in it is trashed after a month.** Its
  hub item stays Kept, with a `notePath` pointing at nothing. That is handled —
  `openItem` re-creates the note if the path is dead — but it means *Kept* is
  now the list of "videos I opened", not "videos with a note", and those two
  drift apart by design.

Put together: the hub is now a queue that empties. That is exactly what makes
the YouTube import awkward, because YouTube's Watch Later is a list that does
not.

## The three problems, in the order they will bite

**1. The import never drains.** You watch a video in Obsidian; YouTube's Watch
Later still holds it, because we never write to YouTube. The item is Kept so it
leaves the Inbox — fine — but the next sync re-imports the same 300 rows
forever, and any that you *hid* rely on a tombstone to stay hidden. Tombstones
are capped at 500 (`HIDDEN_LIMIT`), oldest-hidden falling off first. With a
Watch Later of any size and a habit of hiding things, videos will eventually
come back. Not soon, but by construction.

**2. Two names, one word.** *New-note folder* defaulting to `Watch Later` means
"my Watch Later" is ambiguous in every future conversation — the YouTube list or
the vault folder. The tidy sweep makes this concrete: it empties the *folder*
and touches the *playlist* not at all.

**3. A Watch Later note is the worst note the plugin makes.** No description, no
publish date, and a placeholder paragraph apologising for it. Every other route
into a note carries the description the hub cached at poll time.

## Options

**A. Leave it. One-way seed, and say so.** The import is a way to get videos you
queued on your phone's YouTube app into the hub. You drain the hub; YouTube's
list you clear yourself, or never. Cost: nothing. Risk: problem 1 stays, slowly.

**B. Stop importing Watch Later; the hub is the only queue.** Add from the hub's
Browse screen, from a pasted URL, from the feeds. Cost: you lose the phone-side
YouTube app as a capture route, which is probably the main way things get into
the list in the first place. I do not recommend this.

**C. Two-way — remove from YouTube's Watch Later once you have watched it.**
Solves problem 1 properly. It also means authenticated *writes* to YouTube from
this plugin for the first time, which breaks the one promise the account feature
makes ("nothing goes out"), and yt-dlp's own docs warn that recurring
authenticated requests can get an account flagged. **Recommend against**, and I
would want you to say it twice before I built it.

**D. Small fixes, no architecture.** Three, independent:
   - **d1.** Fetch the description for a Watch Later item at note-creation time,
     unauthenticated through InnerTube — one request, on a click that already
     waits for a file write. Kills problem 3.
   - **d2.** Rename the setting to *New-note folder* everywhere and change the
     default to `Videos` (existing vaults keep whatever they have). Kills
     problem 2.
   - **d3.** Exempt Watch Later items from the tombstone cap, or raise the cap
     for them, so a hidden Watch Later video cannot come back. Kills the sharp
     edge of problem 1 without touching YouTube.

## What I would do

**A + D.** Keep the import as a one-way seed, and spend the small effort on
d1 and d3 (d2 whenever you can stand a setting moving under you). It leaves the
privacy stance intact, keeps the phone capture route, and removes both failure
modes that are actually reachable.

Rough size: d1 is an hour — the InnerTube description fetch already exists for
transcripts, and `buildWatchLaterNote` already has the branch to fill. d3 is
twenty minutes and a test. d2 is a rename and a migration note.

## The question I cannot answer

**When you put something in YouTube's Watch Later, do you also clear it there
yourself?** If yes, option A is simply correct and d3 is belt-and-braces. If no
— if you expect the list to drain because you watched it here — then A leaves
you with a YouTube list that grows forever, and the only thing that fixes it is
C, with the cost above. Say which, and I will build the matching half.

## Acceptance criteria

_None yet — nothing is built. They belong with whichever option you pick._
