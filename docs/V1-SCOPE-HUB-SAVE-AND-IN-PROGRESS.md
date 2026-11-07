# V1 scope — hub Save and In progress (GitHub #49, #50)

**Status (2026-11-07):** approved and built. Isaiah's answers: 1 didn't follow the question,
2 yes, 3 yes, 4 include older notes.

**Question 1, answered from the code:** the hub opens on **Everything** (Isaiah's 2026-09-01
choice), and Everything is "inbox + saved", so a video saved there stays on screen by design.
Save on the **Inbox** list takes it out at once. No code change for #49 beyond the Saved rename.

## What Isaiah asked

- **#49:** Save from a menu takes the video out of the Inbox. It then shows in Saved, and in
  In progress once started.
- **#50:** In progress shows every started video, including one saved as a note, then removed
  from the hub, then watched. It stays until the note is deleted. On those cards Remove says
  **Delete**.

## What main does today (read from the code, not tested on a device)

- **Save on a hub card** (`runItemAction`, `src/hub.ts`) makes the note, marks the video Kept and
  drops the card from the Inbox at once (`dropIfFiltered`).
- **Save inside Preview** goes through the same `runItemAction`, so it should do the same.
- **"Saved" is called Kept** on the hub chips: Inbox, In progress, Kept, Hidden, Everything.
- **Remove on a hub card** hides the video (`hideItem`): state `dismissed`, picture and
  description dropped. The note stays.
- **In progress** (`visibleItems`, `src/subscriptions.ts`) is "has a saved position past the
  floor, not finished" **and not hidden**. So a removed video drops out of In progress even if
  its note exists and you are halfway through. That line is the whole of #50.
- **Deleting a note** makes the hub forget the video (`forget`), so it leaves every list.
- A position at the credits is deleted, so a finished video already leaves In progress.

So for #49 I could not find a path where Save leaves the video in the Inbox. Question 1 is
about that.

## Proposed v1

1. **In progress rule:** started and not finished, **and** either still in the hub (Inbox or
   Kept) **or** hidden but its note still exists. A hidden video with no note stays out (you
   previewed it and turned it down).
2. **Delete button:** a card that is hidden but has a note says **Delete** (trash icon) instead
   of Remove, on the card and inside Preview. It asks once ("Delete note *title*? It goes to
   your trash.") and then trashes the note with `fileManager.trashFile`, which follows
   Obsidian's "Deleted files" setting, so it is recoverable. The existing delete listener then
   forgets the video and it leaves In progress.
3. **Remove on a Kept card in In progress** keeps today's meaning (hide from the hub). The card
   stays in In progress and its button turns into Delete. It does not clear your position.
4. **Hidden cards in In progress** get their picture back from the video ID (the hide dropped
   the stored one).
5. **Save** (#49): no change; see question 1 above.
7. **Notes the hub never had** with a saved position show in In progress too, drawn from the
   note's frontmatter (title, author), with Delete. Watch opens the note; nothing is added to
   the hub. Read from Obsidian's metadata cache when the In progress list is drawn.
6. Same on phone and desktop. Positions and hub state already sync, so a note deleted on one
   device clears In progress on both.

## Questions for Isaiah

1. **Which menu did Save leave the video in the Inbox from?** The hub card and Preview already
   remove it in the code. Candidates: Preview opened from a link, the channel screen, search,
   or something on the phone. If you can't recall, I'll test each on desktop and fix any that
   misbehave.
2. **Rename the Kept chip to Saved?** The button says Save and you call the list Saved.
   Recommend yes: chip "Saved", rule line "saved — a note exists".
3. **Confirm before Delete?** Recommend yes, one dialog, because the note can hold your own
   writing. The alternative is no dialog plus an Undo notice.
4. **Notes that were never in the hub** (made before the hub existed, or by the Web Clipper)
   with a saved position: include them in In progress? Recommend no for v1 and a backlog issue,
   because it needs a vault scan and cards built from note frontmatter.

## Out of v1

- Watch history and stats (#51).
- A "clear progress" action on In progress cards.

## Manual test (after it is built)

Desktop and phone:

1. Inbox: Save a video. It leaves the Inbox at once and is in Saved (chip renamed from Kept).
2. Play that video 2 minutes, close. It is in In progress.
3. In In progress, press Remove on it. It stays in In progress; the button now says Delete.
   It is gone from Inbox, Saved and Everything, and is in Hidden.
4. Press Delete, confirm. The note is in Obsidian's trash; the card leaves In progress.
5. Hide a video with no note after previewing 2 minutes. It is not in In progress.
6. Open an older video note the hub never had, play 2 minutes. It shows in In progress with
   Delete; Watch opens the note.
